import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';
import { findBettingLeague } from '@/lib/betting/leagues';
import { calculateProjectedPoints } from '@/services/stats/scoring';
import { bestAvailableLineup, LineupCandidate } from '@/services/betting/bestLineup';
import {
  StarterInput,
  isMarketOpen,
  matchupRemainingMinutes,
  priceSides,
  sideDistribution,
  winProbability,
} from '@/services/betting/liveOdds';
import playerIndex from '../../../data/player_index.json';

/**
 * Server-side market pricing.
 *
 * The price has to be computed here, not in the browser. A wager references a
 * `markets` row that this module wrote; if the client supplied the odds, anyone
 * could POST themselves +10000 and collect.
 *
 * Uses data/player_index.json (~114 KB, position and team only) rather than
 * data/sleeper_players.json (~22 MB). The big file is fine in a client bundle that
 * already ships it, but parsing it in the Next server process on a 1.9 GB box is
 * not worth it.
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** Sleeper team codes that differ from ESPN's. */
const TEAM_ALIASES: Record<string, string> = { WAS: 'WSH', OAK: 'LV' };

const QUARTERS = 4;
const MINUTES_PER_QUARTER = 15;
const REGULATION_MINUTES = 60;

type IndexRow = { p: string | null; t: string | null };
const PLAYER_INDEX = playerIndex as unknown as Record<string, IndexRow>;

type GameInfo = { id: string; state: 'pre' | 'in' | 'post'; remainingMinutes: number };

export type PricedMarket = {
  id: string;
  matchupId: number;
  rosterA: number;
  rosterB: number;
  ownerA: string | null;
  ownerB: string | null;
  probA: number;
  priceA: number;
  priceB: number;
  remainingMinutes: number;
  open: boolean;
  pointsA: number;
  pointsB: number;
  projectedA: number;
  projectedB: number;
  /** Sd of the points still to come, needed by the season simulation. */
  sdA: number;
  sdB: number;
  nameA: string;
  nameB: string;
  /** Why the number is what it is, per side. */
  detailA: SideDetail;
  detailB: SideDetail;
};

export type SideDetail = {
  promotions: { name: string; projectedPoints: number }[];
  streams: { slot: string; projectedPoints: number }[];
  unfilledSlots: string[];
  playersRemaining: number;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function espnTeam(sleeperTeam: string | null): string | null {
  if (!sleeperTeam) return null;
  return TEAM_ALIASES[sleeperTeam] ?? sleeperTeam;
}

/** Regulation minutes left: 60 before kickoff, 0 once final. */
function remainingFor(state: string, period: number, clock: string): number {
  if (state === 'pre') return REGULATION_MINUTES;
  if (state === 'post') return 0;
  const [mm, ss] = clock.split(':');
  const inQuarter = (Number(mm) || 0) + (Number(ss) || 0) / 60;
  return inQuarter + Math.max(0, QUARTERS - period) * MINUTES_PER_QUARTER;
}

type EspnPayload = {
  events?: {
    id: string;
    competitions?: {
      status?: { period?: number; displayClock?: string; type?: { state?: string } };
      competitors?: { team?: { abbreviation?: string } }[];
    }[];
  }[];
};

async function loadGames(): Promise<{ byTeam: Map<string, GameInfo> } | null> {
  const data = await fetchJson<EspnPayload>(ESPN_SCOREBOARD);
  if (!data) return null;
  const byTeam = new Map<string, GameInfo>();
  for (const event of data.events ?? []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const state = (comp.status?.type?.state ?? 'pre') as GameInfo['state'];
    const info: GameInfo = {
      id: event.id,
      state,
      remainingMinutes: remainingFor(state, comp.status?.period ?? 0, comp.status?.displayClock ?? '0:00'),
    };
    for (const c of comp.competitors ?? []) {
      const abbr = c.team?.abbreviation;
      if (abbr) byTeam.set(abbr, info);
    }
  }
  return { byTeam };
}

type SleeperRosterLite = { roster_id: number; owner_id: string | null; players: string[] | null };
type SleeperMatchupLite = {
  roster_id: number;
  matchup_id: number | null;
  starters: string[] | null;
  starters_points: number[] | null;
  players: string[] | null;
  players_points: Record<string, number> | null;
  points: number | null;
};

/**
 * Recomputes every market for a league week and writes the prices.
 *
 * A market that has already settled is left alone — re-pricing a finished game
 * would move a line that wagers were struck against.
 */
export async function priceLeagueWeek(
  leagueId: string,
  week: number,
): Promise<PricedMarket[]> {
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return [];

  const league = await fetchJson<{
    season: string;
    scoring_settings?: Record<string, number>;
    roster_positions?: string[];
  }>(`${SLEEPER_BASE}/league/${leagueId}`);
  if (!league?.scoring_settings || !league.roster_positions) return [];

  const [rosters, users, matchups, projections, games] = await Promise.all([
    fetchJson<SleeperRosterLite[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    fetchJson<{ user_id: string; display_name: string }[]>(`${SLEEPER_BASE}/league/${leagueId}/users`),
    fetchJson<SleeperMatchupLite[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`),
    fetchJson<Record<string, Record<string, number>>>(
      `${SLEEPER_BASE}/projections/nfl/regular/${league.season}/${week}`,
    ),
    loadGames(),
  ]);

  if (!rosters || !matchups || !projections || !games) return [];

  const scoring = league.scoring_settings;
  const rosterPositions = league.roster_positions;
  const ownerByRoster = new Map(rosters.map(r => [r.roster_id, r.owner_id]));
  const nameByUser = new Map((users ?? []).map(u => [u.user_id, u.display_name]));

  const candidate = (playerId: string, actualPoints: number): LineupCandidate => {
    const row = PLAYER_INDEX[playerId];
    const game = row ? games.byTeam.get(espnTeam(row.t) ?? '') : undefined;
    return {
      playerId,
      position: row?.p ?? null,
      actualPoints,
      projectedPoints: calculateProjectedPoints(projections[playerId], scoring),
      gameState: game ? game.state : 'unknown',
      remainingMinutes: game ? game.remainingMinutes : 0,
    };
  };

  // Unrostered K/DEF, for a slot the roster cannot cover.
  const rostered = new Set<string>();
  for (const r of rosters) for (const p of r.players ?? []) rostered.add(p);
  const freeAgents: LineupCandidate[] = [];
  for (const [playerId, row] of Object.entries(PLAYER_INDEX)) {
    if (rostered.has(playerId)) continue;
    if (row.p !== 'K' && row.p !== 'DEF') continue;
    if (!projections[playerId]) continue;
    const c = candidate(playerId, 0);
    if (c.projectedPoints > 0) freeAgents.push(c);
  }

  const pairs = new Map<number, SleeperMatchupLite[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    const list = pairs.get(m.matchup_id) ?? [];
    list.push(m);
    pairs.set(m.matchup_id, list);
  }

  const streamsByPosition = new Map<string, number>();
  const db = getDb();
  const out: PricedMarket[] = [];

  for (const [matchupId, sides] of [...pairs.entries()].sort((x, y) => x[0] - y[0])) {
    if (sides.length !== 2) continue;

    const build = (m: SleeperMatchupLite) => {
      const starterIds = m.starters ?? [];
      const starterPoints = m.starters_points ?? [];
      const playersPoints = m.players_points ?? {};
      const current = starterIds.map((pid, i) =>
        !pid || pid === '0' ? null : candidate(pid, starterPoints[i] ?? 0),
      );
      const startingSet = new Set(starterIds.filter(p => p && p !== '0'));
      const bench = (m.players ?? [])
        .filter(pid => pid && pid !== '0' && !startingSet.has(pid))
        .map(pid => candidate(pid, playersPoints[pid] ?? 0));
      const best = bestAvailableLineup(rosterPositions, current, bench, freeAgents, streamsByPosition);
      const starters: StarterInput[] = best.starters.map(c => ({
        playerId: c.playerId,
        position: c.position,
        actualPoints: c.actualPoints,
        projectedPoints: c.projectedPoints,
        gameState: c.gameState,
        remainingMinutes: c.remainingMinutes,
        extraSd: c.extraSd,
      }));
      const detail: SideDetail = {
        // Names are not in the slim index, so identify a promotion by id. The UI
        // shows the projection, which is the part that explains the price.
        promotions: best.promoted.map(c => ({ name: c.playerId, projectedPoints: c.projectedPoints })),
        streams: best.streamed.map(s => ({ slot: s.slot, projectedPoints: s.projectedPoints })),
        unfilledSlots: best.unfilledSlots,
        playersRemaining: starters.filter(s => s.gameState === 'pre' || s.gameState === 'in').length,
      };
      return { starters, distribution: sideDistribution(starters), detail };
    };

    const a = build(sides[0]);
    const b = build(sides[1]);
    const probA = winProbability(a.distribution, b.distribution);
    const pricing = priceSides(probA);

    const remaining = matchupRemainingMinutes(
      [...a.starters, ...b.starters],
      pid => {
        const row = PLAYER_INDEX[pid];
        return row ? games.byTeam.get(espnTeam(row.t) ?? '')?.id : undefined;
      },
    );

    const ownerA = ownerByRoster.get(sides[0].roster_id) ?? null;
    const ownerB = ownerByRoster.get(sides[1].roster_id) ?? null;
    const nameA = (ownerA && nameByUser.get(ownerA)) || `Roster ${sides[0].roster_id}`;
    const nameB = (ownerB && nameByUser.get(ownerB)) || `Roster ${sides[1].roster_id}`;

    const existing = db
      .prepare(
        `SELECT id, status FROM markets
         WHERE league_id = ? AND season = ? AND week = ? AND matchup_id = ?`,
      )
      .get(leagueId, cfg.season, week, matchupId) as
      | { id: string; status: string }
      | undefined;

    // Never re-price a settled market: wagers were struck against that line.
    if (existing?.status === 'settled' || existing?.status === 'void') continue;

    const id = existing?.id ?? randomUUID();
    const status = isMarketOpen(remaining) ? 'open' : 'closed';

    if (existing) {
      db.prepare(
        `UPDATE markets SET prob_a = ?, price_a = ?, price_b = ?, status = ?,
           remaining_minutes = ?, owner_a = ?, owner_b = ?, name_a = ?, name_b = ?,
           priced_at = datetime('now')
         WHERE id = ?`,
      ).run(probA, pricing.oddsA, pricing.oddsB, status, remaining, ownerA, ownerB, nameA, nameB, id);
    } else {
      db.prepare(
        `INSERT INTO markets
           (id, league_id, season, week, matchup_id, roster_a, roster_b, owner_a, owner_b,
            name_a, name_b, prob_a, price_a, price_b, status, remaining_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, leagueId, cfg.season, week, matchupId,
        sides[0].roster_id, sides[1].roster_id, ownerA, ownerB, nameA, nameB,
        probA, pricing.oddsA, pricing.oddsB, status, remaining,
      );
    }

    out.push({
      id,
      matchupId,
      rosterA: sides[0].roster_id,
      rosterB: sides[1].roster_id,
      ownerA,
      ownerB,
      probA,
      priceA: pricing.oddsA,
      priceB: pricing.oddsB,
      remainingMinutes: remaining,
      open: status === 'open',
      pointsA: a.distribution.banked,
      pointsB: b.distribution.banked,
      projectedA: a.distribution.mean,
      projectedB: b.distribution.mean,
      sdA: Math.sqrt(a.distribution.variance),
      sdB: Math.sqrt(b.distribution.variance),
      nameA,
      nameB,
      detailA: a.detail,
      detailB: b.detail,
    });
  }

  return out;
}

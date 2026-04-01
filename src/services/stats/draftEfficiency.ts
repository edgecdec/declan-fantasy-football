import { SleeperService, SleeperMatchup, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import {
  DraftPickEfficiency,
  DraftEfficiencyResult,
  LogCurveCoefficients,
  ManagerDraftEfficiency,
  HistoricalPickAverage,
  SeasonDraftSummary,
  HistoricalDraftData,
} from '@/types/draftEfficiency';
import playerData from '../../../data/sleeper_players.json';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const DEFAULT_REGULAR_SEASON_WEEKS = 14;

type PlayerRecord = { first_name: string; last_name: string; position: string; team?: string };
const players = (playerData as unknown as { players: Record<string, PlayerRecord> }).players ?? {};

function getPlayerPosition(playerId: string): string | null {
  const pos = players[playerId]?.position;
  return pos && VALID_POSITIONS.includes(pos) ? pos : null;
}

function getPlayerName(playerId: string): string {
  const p = players[playerId];
  return p ? `${p.first_name} ${p.last_name}` : 'Unknown';
}

function getPlayerTeam(playerId: string): string {
  return players[playerId]?.team || 'FA';
}

function calcPositionalAvg(matchups: SleeperMatchup[], position: string): number {
  let total = 0;
  let count = 0;
  for (const m of matchups) {
    if (!m.starters?.length) continue;
    const pts = (m as Record<string, unknown>).starters_points as number[] | undefined;
    if (!pts) continue;
    for (let i = 0; i < m.starters.length; i++) {
      if (getPlayerPosition(m.starters[i]) === position) {
        total += pts[i] || 0;
        count++;
      }
    }
  }
  return count > 0 ? total / count : 0;
}

function fitLogCurve(picks: DraftPickEfficiency[]): LogCurveCoefficients {
  const valid = picks.filter((p) => p.weeksStarted > 0);
  if (valid.length < 2) return { a: 0, b: 0 };

  // Least squares: y = a * ln(x) + b
  let sumLnX = 0, sumY = 0, sumLnX2 = 0, sumLnXY = 0;
  const n = valid.length;
  for (const p of valid) {
    const lnX = Math.log(p.pickNumber);
    sumLnX += lnX;
    sumY += p.totalEfficiency;
    sumLnX2 += lnX * lnX;
    sumLnXY += lnX * p.totalEfficiency;
  }
  const denom = n * sumLnX2 - sumLnX * sumLnX;
  if (Math.abs(denom) < 1e-10) return { a: 0, b: sumY / n };

  const a = (n * sumLnXY - sumLnX * sumY) / denom;
  const b = (sumY - a * sumLnX) / n;
  return { a, b };
}

export async function calculateDraftEfficiency(
  leagueId: string,
  draftId: string,
  season: string
): Promise<DraftEfficiencyResult> {
  const cacheKey = `draft_efficiency_${draftId}`;
  const cached = CacheService.get<DraftEfficiencyResult>(cacheKey, 'session');
  if (cached) return cached;

  const [league, draftPicks, users, rosters] = await Promise.all([
    SleeperService.getLeague(leagueId),
    SleeperService.getDraftPicks(draftId),
    SleeperService.getLeagueUsers(leagueId),
    SleeperService.getRosters(leagueId),
  ]);

  const totalWeeks = league?.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : DEFAULT_REGULAR_SEASON_WEEKS;

  // Build roster_id -> username map
  const ownerToName: Record<string, string> = {};
  for (const u of users) ownerToName[u.user_id] = u.display_name || u.username;
  const rosterToUsername: Record<number, string> = {};
  for (const r of rosters) rosterToUsername[r.roster_id] = ownerToName[r.owner_id] || `Team ${r.roster_id}`;

  // Fetch all weekly matchups
  const weekMatchups = await Promise.all(
    Array.from({ length: totalWeeks }, (_, i) => SleeperService.getMatchups(leagueId, i + 1))
  );
  const matchupsByWeek = new Map<number, SleeperMatchup[]>();
  weekMatchups.forEach((m, i) => matchupsByWeek.set(i + 1, m));

  // Cache positional averages
  const avgCache = new Map<string, number>();
  function getAvg(week: number, position: string): number {
    const key = `${week}_${position}`;
    if (!avgCache.has(key)) avgCache.set(key, calcPositionalAvg(matchupsByWeek.get(week) || [], position));
    return avgCache.get(key)!;
  }

  const picks: DraftPickEfficiency[] = [];

  for (const pick of draftPicks) {
    const position = getPlayerPosition(pick.player_id);
    if (!position) continue;

    let totalEff = 0;
    let weeksStarted = 0;
    const teamsStartedFor = new Set<number>();

    for (let w = 1; w <= totalWeeks; w++) {
      const wm = matchupsByWeek.get(w) || [];
      for (const m of wm) {
        if (!m.starters?.length) continue;
        const idx = m.starters.indexOf(pick.player_id);
        if (idx === -1) continue;
        const pts = (m as Record<string, unknown>).starters_points as number[] | undefined;
        const points = pts?.[idx] ?? 0;
        totalEff += points - getAvg(w, position);
        weeksStarted++;
        teamsStartedFor.add(m.roster_id);
        break; // player can only be on one roster per week
      }
    }

    picks.push({
      pickNumber: pick.pick_no,
      round: pick.round,
      draftSlot: pick.draft_slot,
      playerId: pick.player_id,
      playerName: getPlayerName(pick.player_id),
      position,
      team: getPlayerTeam(pick.player_id),
      totalEfficiency: Math.round(totalEff * 100) / 100,
      weeksStarted,
      avgEfficiencyPerWeek: weeksStarted > 0 ? Math.round((totalEff / weeksStarted) * 100) / 100 : 0,
      draftedByRosterId: pick.roster_id,
      draftedByUsername: rosterToUsername[pick.roster_id] || `Team ${pick.roster_id}`,
      changedTeams: teamsStartedFor.size > 1,
    });
  }

  const curve = fitLogCurve(picks);
  const result: DraftEfficiencyResult = { picks, curve };
  CacheService.set(cacheKey, result, { storage: 'session' });
  return result;
}

export function aggregateManagerDraftEfficiency(
  picks: DraftPickEfficiency[],
  positionFilter?: string[]
): ManagerDraftEfficiency[] {
  const filtered = positionFilter?.length
    ? picks.filter((p) => positionFilter.includes(p.position))
    : picks;

  const byManager = new Map<number, { username: string; picks: DraftPickEfficiency[] }>();
  for (const p of filtered) {
    if (!byManager.has(p.draftedByRosterId)) {
      byManager.set(p.draftedByRosterId, { username: p.draftedByUsername, picks: [] });
    }
    byManager.get(p.draftedByRosterId)!.picks.push(p);
  }

  const results: ManagerDraftEfficiency[] = [];
  for (const [rosterId, { username, picks: managerPicks }] of byManager) {
    const totalEff = managerPicks.reduce((s, p) => s + p.totalEfficiency, 0);
    const positionBreakdown: Record<string, { total: number; count: number; avg: number }> = {};
    for (const p of managerPicks) {
      if (!positionBreakdown[p.position]) positionBreakdown[p.position] = { total: 0, count: 0, avg: 0 };
      positionBreakdown[p.position].total += p.totalEfficiency;
      positionBreakdown[p.position].count++;
    }
    for (const pos of Object.keys(positionBreakdown)) {
      const bd = positionBreakdown[pos];
      bd.avg = bd.count > 0 ? Math.round((bd.total / bd.count) * 100) / 100 : 0;
      bd.total = Math.round(bd.total * 100) / 100;
    }

    results.push({
      rosterId,
      username,
      totalEfficiency: Math.round(totalEff * 100) / 100,
      avgPerPick: managerPicks.length > 0 ? Math.round((totalEff / managerPicks.length) * 100) / 100 : 0,
      pickCount: managerPicks.length,
      positionBreakdown,
    });
  }

  results.sort((a, b) => b.totalEfficiency - a.totalEfficiency);
  return results;
}

const MIN_HISTORICAL_YEAR = 2017;

export async function fetchHistoricalDraftEfficiency(
  userId: string,
  excludeLeagueId: string | null,
  onSeasonComplete: (data: HistoricalDraftData) => void,
): Promise<HistoricalDraftData> {
  const cacheKey = `hist_draft_eff_${userId}`;
  const cached = CacheService.get<HistoricalDraftData>(cacheKey, 'session');
  if (cached) {
    onSeasonComplete(cached);
    return cached;
  }

  const seasons = await SleeperService.getActiveSeasons(userId, true);

  // Accumulate all picks across all leagues for the average line
  const allPicks: DraftPickEfficiency[] = [];
  const summaries: SeasonDraftSummary[] = [];

  for (const season of seasons.sort()) {
    if (parseInt(season, 10) < MIN_HISTORICAL_YEAR) continue;

    const leagues = await SleeperService.getLeagues(userId, season);
    const completedLeagues = leagues.filter(l =>
      ['in_season', 'complete', 'playoffs'].includes(l.status)
    );

    for (const league of completedLeagues) {
      if (league.league_id === excludeLeagueId) continue;

      try {
        const drafts = await SleeperService.getLeagueDrafts(league.league_id);
        const completeDraft = drafts.find(d => d.status === 'complete');
        if (!completeDraft) continue;

        const result = await calculateDraftEfficiency(
          league.league_id, completeDraft.draft_id, completeDraft.season,
        );

        const rosters = await SleeperService.getRosters(league.league_id);
        const userRoster = rosters.find(r => r.owner_id === userId);
        if (!userRoster) continue;

        const userPicks = result.picks.filter(p => p.draftedByRosterId === userRoster.roster_id);
        if (userPicks.length === 0) continue;

        const totalEff = userPicks.reduce((s, p) => s + p.totalEfficiency, 0);
        summaries.push({
          season,
          leagueName: league.name,
          leagueId: league.league_id,
          draftId: completeDraft.draft_id,
          totalEfficiency: Math.round(totalEff * 100) / 100,
          avgPerPick: Math.round((totalEff / userPicks.length) * 100) / 100,
          pickCount: userPicks.length,
        });

        allPicks.push(...result.picks);
      } catch {
        // Skip leagues that fail
      }
    }

    // Progressive callback after each season
    onSeasonComplete({
      averagesByPick: computeAveragesByPick(allPicks),
      seasonSummaries: [...summaries],
    });
  }

  const final: HistoricalDraftData = {
    averagesByPick: computeAveragesByPick(allPicks),
    seasonSummaries: summaries,
  };
  CacheService.set(cacheKey, final, { storage: 'session' });
  return final;
}

function computeAveragesByPick(picks: DraftPickEfficiency[]): HistoricalPickAverage[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (const p of picks) {
    const entry = sums.get(p.pickNumber) || { total: 0, count: 0 };
    entry.total += p.totalEfficiency;
    entry.count++;
    sums.set(p.pickNumber, entry);
  }
  const result: HistoricalPickAverage[] = [];
  for (const [pickNumber, { total, count }] of sums) {
    result.push({
      pickNumber,
      avgEfficiency: Math.round((total / count) * 100) / 100,
      sampleCount: count,
    });
  }
  result.sort((a, b) => a.pickNumber - b.pickNumber);
  return result;
}

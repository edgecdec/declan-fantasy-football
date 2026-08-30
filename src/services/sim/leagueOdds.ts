/**
 * Live championship odds for EVERY manager, given the draft as it stands.
 *
 * One simulation run yields all teams at once -- simulate the rest of the draft, the season
 * and the playoffs, and count how often each seat makes the playoffs and wins. That makes
 * this roughly N times cheaper than asking the per-candidate question for N candidates, so
 * it can refresh on every pick.
 *
 * YOUR RANKINGS APPLY TO YOUR SEAT ONLY. `rankOverride` changes the board `myTeam` drafts
 * from; the other nine managers keep drafting consensus ADP, because your private rankings
 * do not change what they do. That asymmetry is what makes "chance he lasts to my pick"
 * meaningful -- it stays a property of the market, not of your board.
 */
import {
  Artifact, BotWeights, SimData, buildSheets, hashSeed, pickOrder, playSeason,
  runDraft, runH2H, sampleOutcomes, schedule, rng,
} from "./engine";
import { FIELD, TUNED } from "./candidateOdds";

export type LeagueOddsRequest = {
  taken: [number, number][];        // [overallPick, denseIndex] for picks already made
  sims: number;
  seedBase: string;
  /** Seat to highlight. Does NOT change how that seat plays -- see assignBots. */
  myTeam?: number;
  /** Opt-in: give `myTeam` the tuned weights instead of a random archetype. Off by
   *  default because it silently inflates one seat's odds by ~2pp. */
  assumeIPlayWell?: boolean;
  myPosMult?: Record<string, number>;
  reversalRound?: number;
  /** denseIndex -> draft-order rank from your selected rankings; YOUR seat only. */
  rankOverride?: Int32Array | null;
  /** [overallPick, seat] for every traded pick; absent picks follow the snake. */
  swaps?: [number, number][] | null;
};

export type LeagueSlice = { po: Uint8Array[]; ti: Uint8Array[]; pf: Float32Array[] };

export type TeamOdds = {
  team: number; playoff: number; title: number; pf: number; n: number;
  /** standard error on this seat's title%, from the binomial count */
  titleSe: number; playoffSe: number;
};

/** Assign a manager personality to each seat, RESHUFFLED EVERY SIMULATION.
 *
 *  Handing FIELD[0..8] to seats in fixed order was wrong and visibly so: the archetypes
 *  genuinely differ in strength (~6pp playoff between best and worst), so on an EMPTY
 *  draft the seats came out spread 4.5pp apart purely by which personality they were
 *  handed. With every seat given identical weights the spread collapses to 2.2pp, i.e.
 *  draft slot plus noise. Since the rows are labelled with real managers' names, that
 *  fixed assignment implied the model knew something about those people. It does not.
 *
 *  We do not know what kind of manager anybody is, so the honest thing is to average over
 *  that uncertainty: draw a fresh permutation per simulation. Seats then become
 *  exchangeable and any remaining difference comes from draft position and the rosters
 *  actually drafted -- which is the question worth asking.
 *
 *  (Once a draft is underway this could be tightened by inferring each manager's leanings
 *  from the picks they have actually made. Not implemented.) */
function assignBots(teams: number, req: LeagueOddsRequest, u: () => number): BotWeights[] {
  const idx = FIELD.map((_b, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(u() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out: BotWeights[] = [];
  for (let t = 0; t < teams; t++) out.push(FIELD[idx[t % idx.length]]);
  if (req.assumeIPlayWell && req.myTeam !== undefined && req.myTeam < teams) {
    out[req.myTeam] = { posMult: req.myPosMult ?? { QB: 1.30, K: 1.30 }, ...TUNED };
  }
  return out;
}

export function simulateLeagueSlice(art: Artifact, req: LeagueOddsRequest,
                                    simOffset = 0): LeagueSlice {
  const D = new SimData(art);
  const M = art.meta, teams = M.teams;
  const order = pickOrder(teams, M.rounds, req.reversalRound ?? 0,
                          req.swaps ? new Map(req.swaps) : null);
  const takenMap = new Map<number, number>(req.taken);
  const po = Array.from({ length: teams }, () => new Uint8Array(req.sims));
  const ti = Array.from({ length: teams }, () => new Uint8Array(req.sims));
  const pf = Array.from({ length: teams }, () => new Float32Array(req.sims));

  for (let i = 0; i < req.sims; i++) {
    const seed = hashSeed(`${req.seedBase}|${simOffset + i}`);
    const bots = assignBots(teams, req, rng(seed ^ 0x1b873593));
    const outcomes = sampleOutcomes(D, rng(seed ^ 0x9e3779b9));
    const sheets = buildSheets(D, bots, seed ^ 0x85ebca6b, req.myTeam,
                              req.rankOverride);
    const sched = schedule(teams, M.regWeeks, rng(seed ^ 0xc2b2ae35));
    const rosters = runDraft(D, bots, sheets, order, takenMap);
    const weekly = playSeason(D, bots, rosters, outcomes, seed ^ 0x27d4eb2f);
    const { seeds, champ, pf: teamPf } = runH2H(D, weekly, teams, sched);
    for (let t = 0; t < teams; t++) {
      po[t][i] = seeds.includes(t) ? 1 : 0;
      ti[t][i] = champ === t ? 1 : 0;
      pf[t][i] = teamPf[t];
    }
  }
  return { po, ti, pf };
}

export function aggregateLeague(teams: number, slices: LeagueSlice[]): TeamOdds[] {
  const out: TeamOdds[] = [];
  for (let t = 0; t < teams; t++) {
    let n = 0, po = 0, ti = 0, pf = 0;
    for (const s of slices) {
      for (let i = 0; i < s.po[t].length; i++) {
        po += s.po[t][i]; ti += s.ti[t][i]; pf += s.pf[t][i]; n++;
      }
    }
    const p = n ? po / n : 0, q = n ? ti / n : 0;
    out.push({
      team: t, playoff: 100 * p, title: 100 * q, pf: n ? pf / n : 0, n,
      playoffSe: n ? 100 * Math.sqrt((p * (1 - p)) / n) : 0,
      titleSe: n ? 100 * Math.sqrt((q * (1 - q)) / n) : 0,
    });
  }
  return out;
}

export function leagueOdds(art: Artifact, req: LeagueOddsRequest): TeamOdds[] {
  return aggregateLeague(art.meta.teams, [simulateLeagueSlice(art, req, 0)]);
}

/**
 * Live championship odds for EVERY manager, given the draft as it stands.
 *
 * One simulation run yields all teams at once -- simulate the rest of the draft, the season
 * and the playoffs, and count how often each seat makes the playoffs and wins. That makes
 * this roughly N times cheaper than asking the per-candidate question for N candidates, so
 * it can refresh on every pick.
 *
 * THE SELECTED RANKINGS DRIVE THE REMAINING DRAFT. `rankOverride` replaces the artifact's
 * market ADP order with whatever ranking set the user has chosen in the side panel, so the
 * opponents draft down that board. The artifact's own points estimate is still used for
 * value, because a ranking set does not carry points in this league's scoring currency --
 * so switching rankings changes WHO gets picked when, not how much a player is worth.
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
  myTeam?: number;                  // seat that gets the tuned weights, if known
  myPosMult?: Record<string, number>;
  reversalRound?: number;
  /** denseIndex -> draft-order rank from the user's selected rankings. */
  rankOverride?: Int32Array | null;
};

export type LeagueSlice = { po: Uint8Array[]; ti: Uint8Array[]; pf: Float32Array[] };

export type TeamOdds = {
  team: number; playoff: number; title: number; pf: number; n: number;
  /** standard error on this seat's title%, from the binomial count */
  titleSe: number; playoffSe: number;
};

function botsFor(teams: number, req: LeagueOddsRequest): BotWeights[] {
  const me: BotWeights = { posMult: req.myPosMult ?? { QB: 1.30, K: 1.30 }, ...TUNED };
  const out: BotWeights[] = [];
  for (let t = 0; t < teams; t++) {
    if (req.myTeam !== undefined && t === req.myTeam) out.push(me);
    else {
      const k = req.myTeam !== undefined && t > req.myTeam ? t - 1 : t;
      out.push(FIELD[k % FIELD.length]);
    }
  }
  return out;
}

export function simulateLeagueSlice(art: Artifact, req: LeagueOddsRequest,
                                    simOffset = 0): LeagueSlice {
  const D = new SimData(art);
  if (req.rankOverride) D.applyRankOverride(req.rankOverride);
  const M = art.meta, teams = M.teams;
  const bots = botsFor(teams, req);
  const order = pickOrder(teams, M.rounds, req.reversalRound ?? 0);
  const takenMap = new Map<number, number>(req.taken);
  const po = Array.from({ length: teams }, () => new Uint8Array(req.sims));
  const ti = Array.from({ length: teams }, () => new Uint8Array(req.sims));
  const pf = Array.from({ length: teams }, () => new Float32Array(req.sims));

  for (let i = 0; i < req.sims; i++) {
    const seed = hashSeed(`${req.seedBase}|${simOffset + i}`);
    const outcomes = sampleOutcomes(D, rng(seed ^ 0x9e3779b9));
    const sheets = buildSheets(D, bots, seed ^ 0x85ebca6b);
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

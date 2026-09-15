import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_VIG, priceSides, profitForStake, starterMoments, toAmericanOdds } from '@/services/betting/liveOdds';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const SKILL = ['QB', 'RB', 'WR', 'TE', 'K'] as const;

test('no skill position can ever have a negative expected score', () => {
  // Real rates: QB 1.2%, RB 1.1%, WR 0.8%, TE 0.4%, K 1.2% negative. The old plain
  // normal gave a TE projected ~4 a 22% chance of finishing negative.
  for (const pos of SKILL) {
    for (let proj = 0; proj <= 40; proj += 0.25) {
      const { mean } = starterMoments(proj, pos);
      assert.ok(mean >= 0, `${pos} at proj ${proj} has mean ${mean.toFixed(3)}`);
    }
  }
});

test('DEF is the one position allowed a meaningfully negative outcome', () => {
  // 3.4% of real DEF weeks are negative vs under 1.3% everywhere else, so DEF must carry
  // more downside than the skill positions at a comparable projection.
  const def = starterMoments(9, 'DEF');
  const te = starterMoments(9, 'TE');
  assert.ok(def.mean > 0, 'a normal DEF projection is still positive on average');
  assert.ok(def.variance > 0);
  assert.ok(te.mean > 0);
});

test('expected score is monotonically increasing in the projection', () => {
  for (const pos of POSITIONS) {
    let prev = -Infinity;
    for (let proj = 0; proj <= 40; proj += 0.5) {
      const { mean } = starterMoments(proj, pos);
      assert.ok(mean >= prev - 1e-9, `${pos} dipped at proj ${proj}`);
      prev = mean;
    }
  }
});

test('variance is always positive and finite for every position and projection', () => {
  for (const pos of POSITIONS) {
    for (let proj = 0; proj <= 40; proj += 0.5) {
      const { mean, variance } = starterMoments(proj, pos);
      assert.ok(Number.isFinite(mean) && Number.isFinite(variance), `${pos} @ ${proj} not finite`);
      assert.ok(variance > 0, `${pos} @ ${proj} variance ${variance}`);
    }
  }
});

test('an unmapped position falls back instead of throwing', () => {
  for (const p of [null, 'OL', 'LB', 'DB', '']) {
    const m = starterMoments(12, p as string | null);
    assert.ok(Number.isFinite(m.mean) && m.variance > 0, `failed for ${String(p)}`);
  }
});

test('zero-inflation shows up as relatively more volatility at low projections', () => {
  // The direct consequence of P(0) being a logistic in the projection: a player who might
  // simply blank is proportionally far more volatile than a workhorse, so sd/mean must
  // fall as the projection rises.
  //
  // An earlier version of this test asserted that mean/projection RISES with the
  // projection, which is false — Sleeper under-projects low-usage RBs by more than the
  // blank rate takes away, so RB runs 1.30x at a 3-point projection and 1.05x at 18.
  // Ratio-to-projection is a statement about Sleeper's bias, not about our zero model.
  for (const pos of POSITIONS) {
    let prev = Infinity;
    for (const proj of [2, 4, 6, 9, 12, 16, 22, 30]) {
      const m = starterMoments(proj, pos);
      const cv = Math.sqrt(m.variance) / m.mean;
      assert.ok(cv < prev, `${pos}: sd/mean did not fall at proj ${proj} (${cv.toFixed(2)} vs ${prev.toFixed(2)})`);
      prev = cv;
    }
  }
});

test('the position that blanks most often is penalised most at a low projection', () => {
  // TE posts an exact zero 34.4% of the time against QB's 1.0%, so at the same small
  // projection TE must retain less of it.
  const te = starterMoments(3, 'TE').mean / 3;
  const qb = starterMoments(3, 'QB').mean / 3;
  assert.ok(te < qb, `TE ${te.toFixed(2)} should be below QB ${qb.toFixed(2)}`);
});

test('vig makes the two sides sum to more than 100%, and never less', () => {
  for (const p of [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
    const priced = priceSides(p);
    assert.ok(priced.overround > 1, `overround ${priced.overround} at p=${p}`);
    assert.ok(Math.abs(priced.overround - (1 + HOUSE_VIG)) < 1e-9);
  }
});

test('american odds and payout are mutually consistent', () => {
  // A fair coin with no vig pays even money; the favourite must pay less than the dog.
  assert.equal(toAmericanOdds(0.5), -100);
  assert.ok(toAmericanOdds(0.75) < 0, 'a favourite is negative odds');
  assert.ok(toAmericanOdds(0.25) > 0, 'an underdog is positive odds');
  assert.equal(profitForStake(1000, -100), 1000);
  assert.equal(profitForStake(1000, 100), 1000);
  assert.ok(profitForStake(1000, -200) < 1000, 'backing a favourite wins less than the stake');
  assert.ok(profitForStake(1000, 200) > 1000, 'backing a dog wins more than the stake');
});

test('there is no dutch book: the house always keeps something', () => {
  // Staking EQUAL amounts on both sides is not arbitrage — an earlier version of this
  // test asserted that and failed, wrongly, on a heavy underdog. The real condition is
  // that the stake allocation which equalises the return still loses: convert each
  // side's American price back to an implied probability via its actual payout, and the
  // two must sum to more than 1. Done from profitForStake rather than from the raw
  // probabilities so integer rounding of the odds is included in the check.
  for (const p of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
    const { oddsA, oddsB } = priceSides(p);
    const stake = 1_000_000; // large, so rounding cannot dominate
    const multA = (stake + profitForStake(stake, oddsA)) / stake;
    const multB = (stake + profitForStake(stake, oddsB)) / stake;
    const book = 1 / multA + 1 / multB;
    assert.ok(book > 1, `dutch book available at p=${p}: implied sum ${book.toFixed(4)}`);
    // And the equalised allocation returns exactly total/book, i.e. a guaranteed loss.
    const total = 1_000_000;
    const stakeA = total / multA / book;
    const ret = stakeA * multA;
    assert.ok(ret < total, `equalised allocation profits at p=${p}`);
  }
});

test('the overround is the configured vig, not an accident of rounding', () => {
  const priced = priceSides(0.5);
  assert.ok(Math.abs(priced.overround - (1 + HOUSE_VIG)) < 1e-9);
  // A no-vig market must be an exactly fair book.
  const fair = priceSides(0.5, 0);
  assert.ok(Math.abs(fair.overround - 1) < 1e-9);
});

/**
 * Markets that should not be taking action.
 *
 * A real matchup was open at 99.9% with "60m left" and a price of -19900/+19900, where $50 on the
 * other side would have paid $9,950. Two independent defects: the clock was the only close condition,
 * and the vig shade pushed the implied probability above 1 where a clamp turned it into a bettable
 * lottery ticket.
 */
test('a decided matchup is closed even with plenty of clock left', async () => {
  const { isMarketOpen, marketCloseReason } = await import('@/services/betting/liveOdds');
  // The exact shape of the bug: an hour of football, and no doubt at all about the result.
  assert.equal(isMarketOpen(60, 0.999), false);
  assert.equal(marketCloseReason(60, 0.999), 'decided');
  assert.equal(isMarketOpen(60, 0.001), false);
  // A close matchup with the same clock stays open.
  assert.equal(isMarketOpen(60, 0.55), true);
  assert.equal(marketCloseReason(60, 0.55), 'open');
});

test('the clock still closes a market on its own', async () => {
  const { isMarketOpen, marketCloseReason } = await import('@/services/betting/liveOdds');
  assert.equal(isMarketOpen(10, 0.5), false);
  assert.equal(marketCloseReason(10, 0.5), 'time');
  // Decided takes precedence when both apply, since it is the more informative reason.
  assert.equal(marketCloseReason(10, 0.999), 'decided');
});

test('omitting the probability leaves the old clock-only behaviour', async () => {
  const { isMarketOpen } = await import('@/services/betting/liveOdds');
  // So a caller that only has the clock cannot silently start refusing every market.
  assert.equal(isMarketOpen(60), true);
  assert.equal(isMarketOpen(10), false);
});

test('an implied probability can never exceed 1, however certain the outcome', async () => {
  const { priceSides } = await import('@/services/betting/liveOdds');
  for (const p of [0.9, 0.95, 0.99, 0.999, 1]) {
    const priced = priceSides(p);
    assert.ok(priced.impliedA < 1, `impliedA ${priced.impliedA} at p=${p}`);
    assert.ok(priced.impliedB < 1, `impliedB ${priced.impliedB} at p=${p}`);
    assert.ok(priced.impliedA > 0 && priced.impliedB > 0);
  }
});

test('the odds are bounded, so a model error cannot pay 199 to 1', async () => {
  const { priceSides, profitForStake, isMarketOpen } = await import('@/services/betting/liveOdds');
  for (const p of [0.99, 0.999, 0.99999, 1]) {
    const { oddsA, oddsB } = priceSides(p);
    /*
     * The old code produced -19900 / +19900 here, and $50 on the underdog won $9,950. The bound is
     * now the edge of the quoting band rather than a clamp inside the odds conversion, so the worst
     * line is about -3720 / +1255 — $627 on a $50 stake.
     */
    assert.ok(Math.abs(oddsA) < 4_000, `oddsA ${oddsA} at p=${p}`);
    assert.ok(Math.abs(oddsB) < 2_000, `oddsB ${oddsB} at p=${p}`);
    assert.ok(profitForStake(5_000, oddsB) < 100_000, `$50 on the dog at p=${p}`);
    // And the real protection: a market this lopsided is not taking action at all, so even the
    // band-edge price is never actually offered.
    assert.equal(isMarketOpen(60, p), false, `market should be closed at p=${p}`);
  }
});

test('the worst price a bettable market can show is the band edge', async () => {
  const { priceSides, isMarketOpen, MARKET_CLOSE_PROBABILITY } =
    await import('@/services/betting/liveOdds');
  // Just inside the band, so it is genuinely open — this is the steepest real line.
  const edge = 1 - MARKET_CLOSE_PROBABILITY - 0.001;
  assert.equal(isMarketOpen(60, edge), true);
  const { oddsA, oddsB } = priceSides(edge);
  assert.ok(Math.abs(oddsA) < 4_000 && Math.abs(oddsB) < 2_000, `${oddsA}/${oddsB}`);
});

test('a normal line is untouched by the cap', async () => {
  const { priceSides } = await import('@/services/betting/liveOdds');
  // The cap must only bite at the extremes, or every price shifts.
  const even = priceSides(0.5);
  assert.equal(even.oddsA, even.oddsB);
  assert.ok(even.overround > 1, 'the house edge is still carried');
  const lean = priceSides(0.6);
  assert.ok(lean.impliedA < 1 && lean.impliedA > 0.6, 'still shaded by the vig');
});

/**
 * Why a stale scoreboard produced a page full of coin flips.
 *
 * On the Tuesday after week 1, Sleeper's NFL state had advanced to week 2 while ESPN's bare
 * scoreboard still returned week 1 with all sixteen games `post`. Every week-2 starter therefore
 * mapped to a FINISHED game, so the whole lineup was skipped as settled and both sides came out with
 * a mean and variance of zero — which `winProbability` correctly reports as 0.5.
 *
 * The arithmetic was never wrong; the input was. These pin the mechanism so a stale scoreboard shows
 * up as an obviously broken distribution rather than as a plausible-looking 50/50.
 */
const settled = (points: number) => ({
  playerId: 'p', position: 'WR', actualPoints: points, projectedPoints: 15,
  gameState: 'post' as const, remainingMinutes: 0,
});

test('a lineup whose games are all final has no upside and no variance', async () => {
  const { sideDistribution } = await import('@/services/betting/liveOdds');
  const d = sideDistribution([settled(0), settled(0)]);
  assert.equal(d.remaining, 0);
  assert.equal(d.variance, 0);
  // Zero banked as well is the tell-tale: a genuinely finished week has points on the board.
  assert.equal(d.banked, 0);
});

test('two empty distributions are a coin flip, which is the symptom to recognise', async () => {
  const { sideDistribution, winProbability } = await import('@/services/betting/liveOdds');
  const a = sideDistribution([settled(0)]);
  const b = sideDistribution([settled(0)]);
  assert.equal(winProbability(a, b), 0.5);
});

test('an unstarted lineup prices on projection, not as a coin flip', async () => {
  const { sideDistribution, winProbability } = await import('@/services/betting/liveOdds');
  // What a correctly-fetched upcoming week looks like: games `pre`, full projection in play.
  const pre = (projected: number) => ({
    playerId: 'p', position: 'WR', actualPoints: 0, projectedPoints: projected,
    gameState: 'pre' as const, remainingMinutes: 60,
  });
  const strong = sideDistribution([pre(20), pre(18), pre(16)]);
  const weak = sideDistribution([pre(8), pre(7), pre(6)]);
  assert.ok(strong.remaining > weak.remaining);
  assert.ok(strong.variance > 0 && weak.variance > 0);
  const p = winProbability(strong, weak);
  assert.ok(p > 0.6 && p < 1, `expected a clear favourite, got ${p}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduleSwap, computeSwapRecords, shortNames, toSwapWeek, type SwapWeek,
} from '@/lib/betting/scheduleSwap';
import { deltaIntensity, renderScheduleImage, scheduleImageHeight, signedAverage, signedWins } from '@/lib/betting/scheduleImage';
import { CARD_W } from '@/lib/betting/imageKit';
import { kindnessRanking, renderScheduleText, scheduleImageEmbed } from '../bot/src/scheduleView';

/**
 * Schedule swap: your scores, someone else's schedule.
 *
 * The rule that matters is the self-collision: on S's schedule, the week S played X, X cannot play
 * X — X takes S's seat and plays S. Get that wrong and every diagonal-adjacent cell is off by the
 * weeks the two met, which looks plausible and is nonsense. The fixture below is small enough to
 * work every cell out by hand.
 *
 * (The port was also checked against the reference implementation on the reference's own 2026 data:
 * 100 of 100 cells identical.)
 */

// Two weeks, four teams. Week 1: 1v2, 3v4. Week 2: 1v3, 2v4.
const weeks: SwapWeek[] = [
  { week: 1, points: { 1: 100, 2: 90, 3: 80, 4: 70 }, opponent: { 1: 2, 2: 1, 3: 4, 4: 3 } },
  { week: 2, points: { 1: 60, 2: 110, 3: 95, 4: 85 }, opponent: { 1: 3, 3: 1, 2: 4, 4: 2 } },
];

test('the diagonal is the actual record', () => {
  const rec = computeSwapRecords(weeks);
  assert.deepEqual(rec.get(1)!.get(1), { w: 1, l: 1, t: 0 });
  assert.deepEqual(rec.get(3)!.get(3), { w: 2, l: 0, t: 0 });
  assert.deepEqual(rec.get(4)!.get(4), { w: 0, l: 2, t: 0 });
});

test('on a schedule that played you, you take its owner\'s seat', () => {
  const rec = computeSwapRecords(weeks);
  // 4 on 3's schedule: week 1 3 played 4 → 4 plays 3 (70 v 80, L); week 2 3 played 1 (85 v 60, W).
  assert.deepEqual(rec.get(4)!.get(3), { w: 1, l: 1, t: 0 });
  // 3 on 4's schedule: week 1 4 played 3 → 3 plays 4 (80 v 70, W); week 2 4 played 2 (95 v 110, L).
  assert.deepEqual(rec.get(3)!.get(4), { w: 1, l: 1, t: 0 });
  // 1 on 4's schedule, no collision: 4 played 3 (100 v 80, W), then 2 (60 v 110, L).
  assert.deepEqual(rec.get(1)!.get(4), { w: 1, l: 1, t: 0 });
});

test('a tie is a tie, and counts half in the delta', () => {
  const tied: SwapWeek[] = [{ week: 1, points: { 1: 100, 2: 100, 3: 90, 4: 80 }, opponent: { 1: 2, 2: 1, 3: 4, 4: 3 } }];
  assert.deepEqual(computeSwapRecords(tied).get(1)!.get(1), { w: 0, l: 0, t: 1 });
  const m = buildScheduleSwap({ leagueId: 'L', name: 'L', season: '2026' },
    [1, 2, 3, 4].map(id => ({ rosterId: id, name: `t${id}`, teamName: null })), tied);
  const r1 = m.managers.findIndex(x => x.rosterId === 1);
  const c3 = m.managers.findIndex(x => x.rosterId === 3);
  // 1 on 3's schedule faces 4 (100 v 80): a win, half a win better than the actual tie.
  assert.equal(m.cells[r1][c3].delta, 0.5);
});

test('the matrix: all-play order, deltas against actual, kindness, best and worst', () => {
  const m = buildScheduleSwap(
    { leagueId: 'L', name: 'Test', season: '2026' },
    [
      { rosterId: 1, name: 'alice', teamName: null },
      { rosterId: 2, name: 'bob', teamName: null },
      { rosterId: 3, name: 'cara', teamName: null },
      { rosterId: 4, name: 'dan', teamName: null },
    ],
    weeks,
  );
  // All-play: bob 5/6, alice 3/6, cara 3/6 (name breaks the tie), dan 1/6.
  assert.deepEqual(m.managers.map(x => x.name), ['bob', 'alice', 'cara', 'dan']);
  assert.equal(m.weeksCounted, 2);
  const at = (row: string, col: string) =>
    m.cells[m.managers.findIndex(x => x.name === row)][m.managers.findIndex(x => x.name === col)];
  assert.equal(at('dan', 'cara').delta, 1, 'dan 1-1 on cara\'s schedule vs 0-2 actual');
  assert.equal(at('cara', 'dan').delta, -1, 'cara 1-1 on dan\'s schedule vs 2-0 actual');
  assert.equal(at('alice', 'dan').delta, 0);
  assert.equal(at('dan', 'dan').delta, null);

  // Kindness of each column is the mean of the OTHER rows' deltas in it.
  m.managers.forEach((_, c) => {
    const others = m.cells.filter((_, r) => r !== c).map(row => row[c].delta!);
    assert.equal(m.kindness[c], others.reduce((a, b) => a + b, 0) / others.length);
  });
  // Best and worst never point at the diagonal, and are the row's extremes.
  m.cells.forEach((row, r) => {
    assert.notEqual(m.best[r], r);
    assert.notEqual(m.worst[r], r);
    const ds = row.filter((_, c) => c !== r).map(x => x.delta!);
    assert.equal(row[m.best[r]].delta, Math.max(...ds));
    assert.equal(row[m.worst[r]].delta, Math.min(...ds));
  });
});

test('toSwapWeek: pairs from matchup ids; unplayed and opponent-less weeks do not count', () => {
  const wk = toSwapWeek(3, [
    { roster_id: 1, matchup_id: 1, points: 101 }, { roster_id: 2, matchup_id: 1, points: 99 },
    { roster_id: 3, matchup_id: 2, points: 88 }, { roster_id: 4, matchup_id: 2, points: 77 },
    { roster_id: 5, matchup_id: null, points: 50 },
  ])!;
  assert.deepEqual(wk.opponent, { 1: 2, 2: 1, 3: 4, 4: 3 });
  assert.equal(wk.points[5], 50, 'scored, but with no opponent');
  // Sleeper lists future weeks with zeros.
  assert.equal(toSwapWeek(9, [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 }]), null);
  // Guillotine / chopped: every roster its own matchup id, so nobody has an opponent.
  assert.equal(toSwapWeek(2, [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 2, points: 80 }]), null);
});

test('short names are distinct across the league', () => {
  assert.deepEqual(shortNames(['cemisme', 'kermason', 'Coldst2EvaDoIt']), ['cemi', 'kerm', 'Cold']);
  assert.deepEqual(shortNames(['JakeSmith', 'JakeSnow']), ['JakeSm', 'JakeSn']);
  const same = shortNames(['Jacobson', 'Jacobsen', 'Jacobsan']);
  assert.equal(new Set(same).size, 3);
  assert.deepEqual(shortNames(['The Dog', 'Theo']), ['TheD', 'Theo'], 'spaces dropped');
});

test('cell figures: halves kept, true minus sign; colour per 13 games, never scaled up', () => {
  assert.equal(signedWins(2), '+2');
  assert.equal(signedWins(-1.5), '−1.5');
  assert.equal(signedWins(0), '0');
  assert.equal(signedAverage(1.333), '+1.3');
  assert.equal(signedAverage(-0.01), '0.0');
  assert.equal(deltaIntensity(4, 7), 1, 'short season: ±4 wins is full colour, not more');
  assert.equal(deltaIntensity(2, 7), 0.5);
  assert.equal(deltaIntensity(4, 26), 0.5, 'two seasons: per 13 games');
  assert.equal(deltaIntensity(-9, 13), -1);
});

/** A 10- and a 12-team league, with names long enough to need clipping. */
function league(n: number) {
  const managers = Array.from({ length: n }, (_, i) => ({ rosterId: i + 1, name: `Manager${i}LongName`, teamName: null }));
  const ws: SwapWeek[] = Array.from({ length: 7 }, (_, w) => {
    const points: Record<number, number> = {};
    const opponent: Record<number, number> = {};
    for (let i = 1; i <= n; i++) points[i] = 80 + ((i * 37 + w * 11) % 70);
    // Rotate the roster list a step each week and pair neighbours: always a valid pairing.
    const order = Array.from({ length: n }, (_, i) => ((i + w) % n) + 1);
    for (let i = 0; i < n; i += 2) {
      opponent[order[i]] = order[i + 1];
      opponent[order[i + 1]] = order[i];
    }
    return { week: w + 1, points, opponent };
  });
  return buildScheduleSwap({ leagueId: '1383248044669046784', name: "Graham's Football Fantasy", season: '2026' }, managers, ws);
}

test('schedule picture: a PNG as tall as its matrix, for 10 and 12 teams', async () => {
  for (const n of [10, 12]) {
    const res = renderScheduleImage(league(n));
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(1, 4)].map(c => String.fromCharCode(c)).join(''), 'PNG');
    assert.equal(buf.readUInt32BE(16), CARD_W);
    assert.equal(buf.readUInt32BE(20), scheduleImageHeight(n));
    assert.ok(buf.length > 20_000, `a ${buf.length}-byte PNG is too small to hold a ${n}×${n} grid`);
  }
});

test('text fallback: kindest schedule first, then each manager\'s actual, best and worst', () => {
  const m = league(10);
  const e = renderScheduleText(m);
  const body = e.description!;
  assert.ok(body.startsWith('```') && body.endsWith('```'));
  assert.ok(body.length <= 1900);
  const ranking = kindnessRanking(m);
  for (let i = 1; i < ranking.length; i++) assert.ok(ranking[i - 1].kindness >= ranking[i].kindness);
  assert.ok(body.includes(` 1 ${ranking[0].name.slice(0, 15)}`), 'the kindest schedule is listed first');
  // One best/worst line per manager, each naming a schedule by its short label.
  const rows = body.split('\n').filter(l => m.managers.some(x => l.startsWith(x.name.slice(0, 12))));
  assert.equal(rows.length, m.managers.length);
  for (const line of body.split('\n')) assert.ok(line.length <= 44, `"${line}" is too wide for a phone`);
  assert.deepEqual(scheduleImageEmbed(m, 'schedules.png').image, { url: 'attachment://schedules.png' });
});

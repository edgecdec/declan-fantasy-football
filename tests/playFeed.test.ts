import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayFeed, describeStats, type FeedLeague } from '@/services/plays/playFeed';
import type { StoredPlay } from '@/lib/plays/playStore';

/**
 * The feed's job is to say what a play was worth to YOU, and the trap is that "worth" is
 * league-specific and history-dependent. These cover the two ways a plausible
 * implementation gets it wrong: scoring only the recent plays (which loses the milestone
 * bonuses) and scoring a play once rather than once per league.
 */

const PLAYERS = { '1': { n: 'Ricky Runner', p: 'RB', t: 'KC' }, '2': { n: 'Wide Out', p: 'WR', t: 'KC' } };

function play(id: string, sequence: number, stats: Record<string, Record<string, number>>): StoredPlay {
  return {
    playId: id,
    gameId: 'G1',
    season: '2026',
    week: 1,
    sequence,
    playTime: 1_700_000_000_000 + sequence * 1000,
    metadata: {
      description: `play ${id}`,
      play_type: 'rush',
      quarter_name: '2',
      time_remaining_minutes: 7,
      time_remaining_seconds: 4,
      is_scoring_play: false,
    },
    playStats: Object.entries(stats).map(([player_id, s]) => ({ player_id, stats: s })),
    firstSeenAt: '2026-09-09 20:00:00',
  };
}

function league(
  id: string,
  scoring: Record<string, number>,
  spots: Record<string, { side: 'for' | 'against' | 'other'; isStarter?: boolean }>,
): FeedLeague {
  return {
    leagueId: id,
    leagueName: `League ${id}`,
    scoring,
    roster: new Map(
      Object.entries(spots).map(([pid, spot]) => [
        pid,
        { rosterId: 1, ownerName: 'someone', isStarter: spot.isStarter ?? true, side: spot.side },
      ]),
    ),
  };
}

const PPR = league('ppr', { rush_yd: 0.1, rec: 1, rec_yd: 0.1 }, { '1': { side: 'for' } });
const STANDARD = league('std', { rush_yd: 0.1, rec_yd: 0.1 }, { '1': { side: 'against' } });

test('the same play is worth different points in different leagues', () => {
  const plays = [play('a', 1, { '1': { rec: 1, rec_yd: 10 } })];
  const [entry] = buildPlayFeed(plays, [PPR, STANDARD], PLAYERS);

  const byLeague = new Map(entry.players[0].impacts.map(i => [i.leagueId, i.points]));
  assert.equal(byLeague.get('ppr'), 2);   // 1 reception + 10 yards
  assert.equal(byLeague.get('std'), 1);   // yards only
});

test('the viewer sides are carried through per league', () => {
  const [entry] = buildPlayFeed([play('a', 1, { '1': { rush_yd: 10 } })], [PPR, STANDARD], PLAYERS);
  const sides = new Map(entry.players[0].impacts.map(i => [i.leagueId, i.side]));
  assert.equal(sides.get('ppr'), 'for');
  assert.equal(sides.get('std'), 'against');
});

test('a milestone bonus fires once, on the play that crosses the line', () => {
  const bonusLeague = league(
    'bonus',
    { rush_yd: 0.1, bonus_rush_yd_100: 5 },
    { '1': { side: 'for' } },
  );
  const plays = [
    play('a', 1, { '1': { rush_att: 1, rush_yd: 60 } }),
    play('b', 2, { '1': { rush_att: 1, rush_yd: 45 } }), // crosses 100 here
    play('c', 3, { '1': { rush_att: 1, rush_yd: 20 } }),
  ];
  const entries = buildPlayFeed(plays, [bonusLeague], PLAYERS);
  const points = new Map(entries.map(e => [e.playId, e.players[0].impacts[0].points]));

  assert.equal(points.get('a'), 6);          // 60 yards, no bonus yet
  assert.ok(Math.abs(points.get('b')! - 9.5) < 1e-9);  // 45 yards + the 5-point bonus
  assert.equal(points.get('c'), 2);          // past 100 already: no second bonus
});

test('trimming the feed does not change the points on the plays that survive', () => {
  // The bug this guards: scoring only the last N plays. The milestone above needs the
  // running total from the start of the week, so a limit must apply AFTER scoring.
  const bonusLeague = league('bonus', { rush_yd: 0.1, bonus_rush_yd_100: 5 }, { '1': { side: 'for' } });
  const plays = [
    play('a', 1, { '1': { rush_yd: 60 } }),
    play('b', 2, { '1': { rush_yd: 45 } }),
    play('c', 3, { '1': { rush_yd: 20 } }),
  ];
  const full = buildPlayFeed(plays, [bonusLeague], PLAYERS);
  const trimmed = buildPlayFeed(plays, [bonusLeague], PLAYERS, 1);

  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].playId, 'c');
  assert.equal(trimmed[0].players[0].impacts[0].points, full[0].players[0].impacts[0].points);
});

test('the feed reads newest first', () => {
  const plays = [
    play('a', 1, { '1': { rush_yd: 5 } }),
    play('b', 2, { '1': { rush_yd: 5 } }),
    play('c', 3, { '1': { rush_yd: 5 } }),
  ];
  assert.deepEqual(buildPlayFeed(plays, [PPR], PLAYERS).map(e => e.playId), ['c', 'b', 'a']);
});

test('plays are replayed in sequence order however they arrive', () => {
  // Storage returns rows in insertion order in some paths, and the reconcile pass banks a
  // whole week at once. Scoring in arrival order would put the milestone on the wrong play.
  const bonusLeague = league('bonus', { rush_yd: 0.1, bonus_rush_yd_100: 5 }, { '1': { side: 'for' } });
  const scrambled = [
    play('c', 3, { '1': { rush_yd: 20 } }),
    play('a', 1, { '1': { rush_yd: 60 } }),
    play('b', 2, { '1': { rush_yd: 45 } }),
  ];
  const entries = buildPlayFeed(scrambled, [bonusLeague], PLAYERS);
  const crossing = entries.find(e => e.playId === 'b')!;
  assert.ok(Math.abs(crossing.players[0].impacts[0].points - 9.5) < 1e-9);
});

test('a play nobody rosters is left out entirely', () => {
  const plays = [play('a', 1, { '99': { rush_yd: 50 } })];
  assert.equal(buildPlayFeed(plays, [PPR], PLAYERS).length, 0);
});

test('a scoreless play is not a feed entry', () => {
  // An incompletion credited to a rostered quarterback earns nothing, and a feed full of
  // 0.00 rows is noise.
  const plays = [play('a', 1, { '1': { rush_att: 1, rush_yd: 0 } })];
  assert.equal(buildPlayFeed(plays, [PPR], PLAYERS).length, 0);
});

test('an unrostered player still advances the totals behind a milestone', () => {
  // The player is picked up partway through the week. The bonus depends on the whole game,
  // so his earlier yards have to have been counted even though nobody rostered him then.
  const bonusLeague = league('bonus', { rush_yd: 0.1, bonus_rush_yd_100: 5 }, { '1': { side: 'for' } });
  const plays = [
    play('a', 1, { '1': { rush_yd: 95 } }),
    play('b', 2, { '1': { rush_yd: 10 } }),
  ];
  const entries = buildPlayFeed(plays, [bonusLeague], PLAYERS);
  const second = entries.find(e => e.playId === 'b')!;
  assert.ok(Math.abs(second.players[0].impacts[0].points - 6) < 1e-9); // 1.0 yards + 5 bonus
});

test('bench players are flagged, not hidden', () => {
  const benched = league('b', { rush_yd: 0.1 }, { '1': { side: 'for', isStarter: false } });
  const [entry] = buildPlayFeed([play('a', 1, { '1': { rush_yd: 50 } })], [benched], PLAYERS);
  assert.equal(entry.players[0].impacts[0].isStarter, false);
  // Nothing in the viewer's lineup moved, so neither side's flag is set.
  assert.equal(entry.yourStarter, false);
  assert.equal(entry.theirStarter, false);
});

test('the side flags distinguish your starters from your opponents', () => {
  // The distinction a single "concerns me" flag could not draw: every play in this feed involves
  // the viewer's roster or their opponent's, so a combined flag was true for all of them.
  const [mine] = buildPlayFeed([play('a', 1, { '1': { rush_yd: 50 } })], [PPR], PLAYERS);
  assert.equal(mine.yourStarter, true);
  assert.equal(mine.theirStarter, false);

  const [theirs] = buildPlayFeed([play('a', 1, { '1': { rush_yd: 50 } })], [STANDARD], PLAYERS);
  assert.equal(theirs.yourStarter, false);
  assert.equal(theirs.theirStarter, true);
});

test('a play can cut both ways at once', () => {
  // Your quarterback throwing to your opponent's receiver, in two different leagues. Both flags
  // must set — collapsing this to one side would misreport the play worth seeing most.
  const bothWays = buildPlayFeed(
    [play('a', 1, { '1': { rush_yd: 50 } })],
    [PPR, STANDARD],
    PLAYERS,
  );
  assert.equal(bothWays[0].yourStarter, true);
  assert.equal(bothWays[0].theirStarter, true);
});

test('defensive keys the play feed cannot be trusted for are not captioned', () => {
  // The feed over-attributes idp_*/def_* to offensive players — a quarterback shown with
  // two forced fumbles he did not force. Scoring already excludes them; so must the caption.
  const plays = [play('a', 1, { '1': { rush_yd: 20, idp_ff: 2, sack: 1 } })];
  const [entry] = buildPlayFeed(plays, [PPR], PLAYERS);
  assert.deepEqual(Object.keys(entry.players[0].stats).sort(), ['rush_yd']);
});

test('the clock and quarter come through in a readable shape', () => {
  const [entry] = buildPlayFeed([play('a', 1, { '1': { rush_yd: 5 } })], [PPR], PLAYERS);
  assert.equal(entry.quarter, '2');
  assert.equal(entry.clock, '7:04');
});

test('players within a play are ordered by what they were worth', () => {
  const both = league('x', { rush_yd: 0.1, rec: 1, rec_yd: 0.1 }, {
    '1': { side: 'for' }, '2': { side: 'for' },
  });
  const plays = [play('a', 1, { '1': { rush_yd: 2 }, '2': { rec: 1, rec_yd: 40 } })];
  const [entry] = buildPlayFeed(plays, [both], PLAYERS);
  assert.deepEqual(entry.players.map(p => p.playerId), ['2', '1']);
});

test('describeStats says what happened, not how much it was worth', () => {
  assert.equal(describeStats({ rec: 1, rec_yd: 27, rec_fd: 1 }), '1 rec, 27 yd · 1st down');
  assert.equal(describeStats({ rush_att: 1, rush_yd: 4, rush_td: 1 }), '1 rush, 4 yd · rush TD');
  assert.equal(describeStats({ pass_att: 1 }), 'incomplete');
  assert.equal(describeStats({}), '');
});

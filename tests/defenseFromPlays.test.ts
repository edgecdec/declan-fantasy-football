import test from 'node:test';
import assert from 'node:assert/strict';
import { defenseStatsForPlay, fumbleRecoveries } from '@/services/plays/defenseFromPlays';

/**
 * Rebuilding a team defence from a play.
 *
 * Every rule here was derived from a real play that broke a simpler version, so the tests are the
 * failures rather than a restatement of the code.
 */

const ctx = (over: Partial<Parameters<typeof defenseStatsForPlay>[1]> = {}) => ({
  possession: 'PHI', opponent: 'LAC', playType: 'pass', description: '', ...over,
});

test('a sack is credited from the QUARTERBACK\'s line, to the defending team', () => {
  // pass_sack is the offence's own stat, which is the half of the feed proven exact. idp_sack on the
  // defender would look more natural and is the unreliable one.
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { pass_sack: 1, pass_sack_yds: -7 } }],
    ctx({ playType: 'pass_incomplete_sacked' }),
  );
  assert.equal(out.get('LAC')?.sack, 1);
  assert.equal(out.get('PHI'), undefined);
});

test('an interception is credited from pass_int', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { pass_att: 1, pass_int: 1 } }],
    ctx({ playType: 'pass_interception' }),
  );
  assert.equal(out.get('LAC')?.int, 1);
});

test('a safety and a blocked kick reach the defence', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'd', stats: { idp_safe: 1 } }, { player_id: 'e', stats: { blk_kick: 1 } }],
    ctx(),
  );
  assert.equal(out.get('LAC')?.safe, 1);
  assert.equal(out.get('LAC')?.blk_kick, 1);
});

test('recovering your OWN fumble credits nobody', () => {
  // The play carries `fum` but not `fum_lost`, which is the only thing distinguishing it — the
  // description says "RECOVERED by" either way.
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { fum: 1 } }],
    ctx({ description: 'J.Herbert FUMBLES, forced by J.Hunt. Fumble RECOVERED by PHI-B.Toth at PHI 30.' }),
  );
  assert.equal(out.get('LAC')?.fum_rec, undefined);
  assert.equal(out.get('PHI')?.fum_rec, undefined);
});

test('a fumble that changed hands credits the team the description names', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { fum: 1, fum_lost: 1 } }],
    ctx({ description: 'J.Hurts FUMBLES. Fumble RECOVERED by LAC-B.Young at PHI 42.' }),
  );
  assert.equal(out.get('LAC')?.fum_rec, 1);
});

test('an interception fumbled BACK credits the original offence, not the defence', () => {
  /*
   * The play that broke the obvious rule. Hurts is intercepted by a Charger, who fumbles, and
   * Philadelphia recovers. "The defence gets the recovery" is simply false — possession changed
   * twice, and only the description says where the ball ended up.
   */
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { pass_int: 1, fum_lost: 1 } }],
    ctx({
      playType: 'pass_interception',
      description: 'J.Hurts pass INTERCEPTED. Intercepted by D.Hand at LAC 17. D.Hand FUMBLES. '
        + 'Fumble RECOVERED by PHI-J.Hurts at LAC 20.',
    }),
  );
  assert.equal(out.get('PHI')?.fum_rec, 1);
  assert.equal(out.get('LAC')?.fum_rec, undefined);
  // The interception itself still counts for the defence.
  assert.equal(out.get('LAC')?.int, 1);
});

test('a KICK RETURN touchdown is special teams, never a defensive score', () => {
  /*
   * The trap that cost the most. On a kickoff `possession` is the KICKING team, so the returner
   * always looks like "the defence" — which credited every return touchdown as a pick-six and put
   * three phantom def_tds in a single week.
   */
  const out = defenseStatsForPlay(
    [{ player_id: 'r', stats: { kr: 1, kr_yd: 99 } }],
    ctx({
      possession: 'ATL', opponent: 'SEA', playType: 'kickoff', isScoringPlay: true,
      scoringTeam: 'SEA',
      description: 'Z.Gonzalez kicks 65 yards. R.Shaheed returns the kickoff. TOUCHDOWN.',
    }),
  );
  assert.equal(out.get('SEA')?.def_st_td, 1);
  assert.equal(out.get('SEA')?.def_td, undefined);
});

test('a punt return touchdown is handled the same way', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'r', stats: { pr: 1 } }],
    ctx({
      possession: 'LV', opponent: 'DEN', playType: 'punt', isScoringPlay: true, scoringTeam: 'DEN',
      description: 'A.Cole punts 42 yards. M.Mims returned punt. TOUCHDOWN.',
    }),
  );
  assert.equal(out.get('DEN')?.def_st_td, 1);
  assert.equal(out.get('DEN')?.def_td, undefined);
});

test('a pick-six IS a defensive touchdown', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { pass_int: 1 } }],
    ctx({
      possession: 'CIN', opponent: 'BUF', playType: 'pass_interception', isScoringPlay: true,
      scoringTeam: 'BUF',
      description: 'J.Burrow pass INTERCEPTED. Intercepted by C.Benford at BUF 37. TOUCHDOWN.',
    }),
  );
  assert.equal(out.get('BUF')?.def_td, 1);
  assert.equal(out.get('BUF')?.def_st_td, undefined);
});

test('an offensive touchdown credits no defence', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'wr', stats: { rec: 1, rec_td: 1 } }],
    ctx({ isScoringPlay: true, scoringTeam: 'PHI', description: 'Catch made by A.Brown. TOUCHDOWN.' }),
  );
  assert.equal(out.size, 0);
});

test('a play with no possession context yields nothing rather than guessing', () => {
  assert.equal(defenseStatsForPlay([{ player_id: 'qb', stats: { pass_sack: 1 } }], {}).size, 0);
  assert.equal(
    defenseStatsForPlay([{ player_id: 'qb', stats: { pass_sack: 1 } }], { possession: 'PHI' }).size,
    0,
  );
});

test('the LAST recovery named wins, since a ball can change hands twice', () => {
  assert.equal(fumbleRecoveries('Fumble RECOVERED by LAC-A at 30.'), 'LAC');
  assert.equal(
    fumbleRecoveries('Fumble RECOVERED by LAC-A. RECOVERED by PHI-B at 20.'),
    'PHI',
  );
  assert.equal(fumbleRecoveries('no recovery here'), null);
});

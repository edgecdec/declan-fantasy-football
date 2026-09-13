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

/**
 * Return yardage — the largest thing a first version missed.
 *
 * Easy to overlook because it is not an "event": a league paying 0.04 a return yard scored one
 * defence 6.68 points for 167 kickoff-return yards, more than three sacks were worth.
 */
test('kickoff return yards go to the returning unit, not the kicking one', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'r', stats: { kr: 1, kr_yd: 34 } }],
    ctx({ possession: 'LAR', opponent: 'ARI', playType: 'kickoff', description: 'kicks 65 yards. J.Brooks returns the kickoff.' }),
  );
  // Possession on a kickoff is the KICKING team, so the returner is on the other side.
  assert.equal(out.get('ARI')?.def_kr_yd, 34);
  assert.equal(out.get('LAR'), undefined);
});

test('punt return yards are separated from kickoff return yards', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'r', stats: { pr: 1, pr_yd: 12 } }],
    ctx({ possession: 'MIA', opponent: 'NYJ', playType: 'punt', description: 'punts 58 yards. I.Williams returned punt.' }),
  );
  assert.equal(out.get('NYJ')?.def_pr_yd, 12);
  assert.equal(out.get('NYJ')?.def_kr_yd, undefined);
});

test('return yards are only credited on a return play', () => {
  // A receiver's yards are not return yards, however the stat happens to be named.
  const out = defenseStatsForPlay(
    [{ player_id: 'wr', stats: { rec: 1, rec_yd: 40, kr_yd: 0 } }],
    ctx({ playType: 'pass' }),
  );
  assert.equal(out.get('LAC')?.def_kr_yd, undefined);
});

test('a forced fumble comes from the narration, not from idp_ff', () => {
  /*
   * idp_ff is the field that looks right and is not: on a sack-fumble it lands on the FUMBLING
   * quarterback, which is how an IDP league came to price a quarterback for two forced fumbles.
   */
  const out = defenseStatsForPlay(
    [{ player_id: 'qb', stats: { fum: 1, idp_ff: 1 } }],
    ctx({ description: 'J.Herbert FUMBLES, forced by J.Hunt. Fumble RECOVERED by LAC-S.Matlock.' }),
  );
  assert.equal(out.get('LAC')?.ff, 1);
  assert.equal(out.get('PHI')?.ff, undefined);
});

test('a forced fumble on a return is credited to the KICKING team', () => {
  // The forcing side is whoever does not have the ball — which on a return is the kicking team.
  const out = defenseStatsForPlay(
    [{ player_id: 'r', stats: { kr: 1, fum: 1 } }],
    ctx({
      possession: 'GB', opponent: 'CHI', playType: 'kickoff',
      description: 'J.Blackwell returns the kickoff. J.Blackwell FUMBLES, forced by T.Hopper.',
    }),
  );
  assert.equal(out.get('GB')?.def_st_ff, 1);
  assert.equal(out.get('CHI')?.ff, undefined);
});

test('a fumble with nobody forcing it credits no forced fumble', () => {
  const out = defenseStatsForPlay(
    [{ player_id: 'rb', stats: { fum: 1 } }],
    ctx({ description: 'A.Jones FUMBLES. Fumble RECOVERED by PHI-A.Jones.' }),
  );
  assert.equal(out.get('LAC')?.ff, undefined);
});

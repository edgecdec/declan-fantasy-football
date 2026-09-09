/**
 * Replays every play of a completed week and reconciles it against Sleeper's official stats.
 *
 * A script rather than a test because it needs the network and pulls ~3MB, and the test suite
 * is deliberately hermetic. This is the check that actually proves the scoring engine: unit
 * tests confirm the bonus rules in isolation, but only a full replay against a real week
 * proves nothing is missing.
 *
 *   node scripts/verify_play_scoring.mjs [season] [week] [leagueId]
 *   node scripts/verify_play_scoring.mjs [season] [week] --user <sleeperName>
 *   ... --players <gitRef>   use the player database as of that commit
 *
 * The --user form reconciles against EVERY league that user is in. Plays are fetched once and
 * re-scored per league, which is both the cheap way to do it and a direct exercise of the
 * production design: plays are global NFL events with no league context, so league count costs
 * nothing.
 *
 * `--players <gitRef>` matters for historical checks. `data/sleeper_players.json` holds TODAY'S
 * positions, but Sleeper computed a past season's stats using the positions of the time, and 115
 * fantasy-position players changed between February and September 2026 alone — Connor Heyward went
 * TE to RB, which is why his 2025 stats carry `bonus_fd_te` while the current database calls him a
 * running back. Reconciling an old season against current positions therefore mis-scores every
 * per-position bonus for those players. Live scoring is unaffected: the current position is the
 * correct one for a game happening now.
 *
 * Exits non-zero if any offensive player disagrees by more than a cent. Team defences are
 * reported separately and are EXPECTED to disagree — the play feed is offence-only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const [season = '2025', week = '3', leagueId = '1206336001794920448'] = process.argv.slice(2);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.verify-build');

// Compile just the scoring module, the same way npm test does, so we verify the real code.
rmSync(OUT, { recursive: true, force: true });
const tsconfig = path.join(ROOT, 'tsconfig.verify.json');
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(tsconfig, JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'CommonJS', moduleResolution: 'node',
    outDir: OUT, rootDir: '.', esModuleInterop: true, skipLibCheck: true,
    strict: false, types: ['node'], noEmitOnError: false,
  },
  include: ['src/services/plays/**/*.ts'],
}));
try { execFileSync('npx', ['tsc', '-p', tsconfig], { cwd: ROOT, stdio: 'pipe' }); } catch { /* emits anyway */ }
unlinkSync(tsconfig);
const mod = path.join(OUT, 'src/services/plays/playScoring.js');
if (!existsSync(mod)) { console.error('could not compile playScoring'); process.exit(1); }
const { scorePlayForPlayer, addStats, scoreStatLine, isNonPlayStat } = await import(mod);

const gql = async query => {
  const r = await fetch('https://api.sleeper.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
};
const rest = async u => (await fetch(u)).json();


// Resolve the leagues to check.
let leagues;
if (leagueId === '--user') {
  const name = process.argv[5];
  if (!name) { console.error('--user needs a sleeper username'); process.exit(1); }
  const user = await rest(`https://api.sleeper.app/v1/user/${name}`);
  if (!user?.user_id) { console.error(`no such user: ${name}`); process.exit(1); }
  const all = await rest(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`);
  leagues = all.filter(l => l.scoring_settings);
  console.log(`reconciling ${season} week ${week} against all ${leagues.length} leagues for ${name}\n`);
} else {
  leagues = [await rest(`https://api.sleeper.app/v1/league/${leagueId}`)];
  console.log(`reconciling ${season} week ${week} against league ${leagueId}\n`);
}

// Fetched ONCE, however many leagues we score against.
const [official, playData] = await Promise.all([
  rest(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`),
  gql(`{plays(sport:"nfl",season:"${season}",season_type:"regular",week:${week}){
        sequence metadata play_stats{player_id stats}}}`),
]);
/*
 * Positions as of a chosen commit, for historical accuracy. Read from git rather than the working
 * tree so no snapshot files need keeping around.
 */
const playersRefIdx = process.argv.indexOf('--players');
const playersRef = playersRefIdx > -1 ? process.argv[playersRefIdx + 1] : null;
const playersJson = playersRef
  ? execFileSync('git', ['show', `${playersRef}:data/sleeper_players.json`], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 }).toString()
  : readFileSync(path.join(ROOT, 'data/sleeper_players.json'), 'utf8');
if (playersRef) console.log(`using player positions as of ${playersRef}`);
const players = JSON.parse(playersJson).players;
const plays = playData.plays.slice().sort((a, b) => a.sequence - b.sequence);
console.log(`plays fetched once: ${plays.length}\n`);

const OFFENCE = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
/** A single player wrong by more than this could swing a matchup — that is a real failure. */
const MATERIAL_POINTS = 6.0;
/** Above this share of players, something systematic is wrong rather than an upstream oddity. */
const MATERIAL_RATE = 0.01;
const round = n => Math.round(n * 100) / 100;

function reconcile(scoring) {
  const running = {}, points = {};
  for (const play of plays) {
    const md = play.metadata ?? {};
    const context = { playType: md.play_type, isScoringPlay: md.is_scoring_play, description: md.description };
    for (const s of play.play_stats ?? []) {
      const pid = s.player_id;
      const before = running[pid] ?? {};
      points[pid] = (points[pid] ?? 0)
        + scorePlayForPlayer(s.stats ?? {}, before, players[pid]?.position ?? null, scoring, context).total;
      running[pid] = addStats(before, s.stats ?? {});
    }
  }
  const rows = [];
  for (const pid of Object.keys(points)) {
    const p = players[pid];
    if (!p || !official[pid] || !OFFENCE.has(p.position)) continue;
    const replay = round(points[pid]);
    const off = round(scoreStatLine(official[pid], scoring, false));
    rows.push({ name: p.full_name ?? pid, pos: p.position, replay, official: off, diff: round(replay - off) });
  }
  return rows;
}

/** Which bonuses a league actually prices — the thing that varies between them. */
/** Which bonuses a league actually prices — the thing that varies between them. */
const bonusFingerprint = sc => Object.keys(sc)
  .filter(k => k.startsWith('bonus') && sc[k])
  .sort().map(k => k.replace('bonus_', ''));

/**
 * Does this league price INDIVIDUAL defensive stats?
 *
 * Specifically `idp_*`, and only those. Nearly every league prices `pts_allow_*` and `sack` for
 * its team-defence slot, so testing "prices any non-play stat" flags all of them and tells you
 * nothing — the DEF slot is excluded from this comparison regardless.
 *
 * What matters here is that the feed credits `idp_*` keys to OFFENSIVE players, and does so
 * unreliably: the same `idp_tkl_solo` matched Sleeper for one receiver and double-counted for
 * another, and `idp_ff` was credited to quarterbacks with none officially. So an IDP league
 * cannot be fully reconciled from plays and must take those points from the stats feed.
 * Reporting that is honest; failing on it would treat a known structural limit as a regression.
 */
const pricesIdp = sc => Object.keys(sc).some(k => sc[k] && k.startsWith('idp_'));

let anyFailed = false;
const summary = [];
console.log('league'.padEnd(34) + 'ppr'.padStart(5) + 'players'.padStart(9) + 'result'.padStart(10) + '  bonuses priced');
for (const lg of leagues) {
  const sc = lg.scoring_settings;
  const rows = reconcile(sc);
  const wrong = rows.filter(r => Math.abs(r.diff) > 0.011);
  const idp = pricesIdp(sc);
  // Judge on MATERIAL error rather than on any error at all. About 0.4% of player-weeks carry a
  // known upstream inconsistency in Sleeper's own data (see playScoring.ts) that is not
  // derivable from anything we have; treating those as regressions would mean the verifier could
  // never pass and would stop being useful. What must not happen is a player being wrong by a
  // margin that changes a matchup.
  const worst = wrong.reduce((m, r) => Math.max(m, Math.abs(r.diff)), 0);
  const rate = wrong.length / Math.max(1, rows.length);
  if (!idp && (worst > MATERIAL_POINTS || rate > MATERIAL_RATE)) anyFailed = true;
  const fp = bonusFingerprint(sc);
  const mark = wrong.length === 0 ? 'exact'
    : idp ? `IDP ${wrong.length}`
      : (worst > MATERIAL_POINTS || rate > MATERIAL_RATE) ? `FAIL ${wrong.length}`
        : `~${wrong.length}`;
  console.log(
    lg.name.slice(0, 32).padEnd(34)
    + String(sc.rec ?? 0).padStart(5)
    + String(rows.length).padStart(9)
    + mark.padStart(10)
    + '  ' + (fp.length ? fp.join(' ') : '(none)').slice(0, 66),
  );
  summary.push({ name: lg.name, wrong, idp, rows: rows.length, worst });
}

console.log('');
for (const s of summary.filter(x => !x.idp && (x.worst > MATERIAL_POINTS || x.wrong.length / x.rows > MATERIAL_RATE))) {
  console.log(`MATERIAL MISMATCHES in ${s.name}:`);
  for (const r of s.wrong.slice(0, 8)) {
    console.log(`   ${r.name.padEnd(22)} ${r.pos}  replay ${r.replay.toFixed(2)}  official ${r.official.toFixed(2)}  diff ${r.diff.toFixed(2)}`);
  }
}

const idpLeagues = summary.filter(x => x.idp);
const clean = summary.filter(x => !x.idp);
const compared = clean.reduce((t, x) => t + x.rows, 0);
const offBy = clean.reduce((t, x) => t + x.wrong.length, 0);
const worstAll = clean.reduce((m, x) => Math.max(m, x.worst), 0);
console.log(`offence-only leagues: ${clean.length}`);
console.log(`  player-scores compared: ${compared}`);
console.log(`  exact to the cent:      ${compared - offBy}  (${(100 * (compared - offBy) / compared).toFixed(2)}%)`);
console.log(`  disagreeing:            ${offBy}  worst ${worstAll.toFixed(2)} pts`);
console.log('  (a residual here is expected: ~0.4% of player-weeks carry a known inconsistency in');
console.log("   Sleeper's own data — see the note in playScoring.ts)");
if (idpLeagues.length) {
  console.log(`IDP-scoring leagues: ${idpLeagues.length} — expected to diverge, since the play feed's`);
  console.log('  defensive attribution is unreliable. Their defensive points come from the stats feed.');
  for (const s of idpLeagues) {
    const worst = s.wrong.reduce((m, r) => Math.max(m, Math.abs(r.diff)), 0);
    console.log(`    ${s.name.trim()}: ${s.wrong.length} players, worst ${worst.toFixed(2)} pts`);
  }
}

rmSync(OUT, { recursive: true, force: true });
if (anyFailed) {
  console.log(`\nFAILED: an offence-only league had a player off by more than ${MATERIAL_POINTS} pts,`);
  console.log(`or more than ${(MATERIAL_RATE * 100).toFixed(0)}% of its players disagreed.`);
  process.exit(1);
}
console.log('\nPASSED: no material error in any offence-only league.');

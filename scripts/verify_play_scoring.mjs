/**
 * Replays every play of a completed week and reconciles it against Sleeper's official stats.
 *
 * A script rather than a test because it needs the network and pulls ~3MB, and the test suite
 * is deliberately hermetic. This is the check that actually proves the scoring engine: unit
 * tests confirm the bonus rules in isolation, but only a full replay against a real week
 * proves nothing is missing.
 *
 *   node scripts/verify_play_scoring.mjs [season] [week] [leagueId]
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
const { scorePlayForPlayer, addStats, scoreStatLine } = await import(mod);

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

console.log(`replaying ${season} week ${week} against league ${leagueId}\n`);
const [league, official, playData] = await Promise.all([
  rest(`https://api.sleeper.app/v1/league/${leagueId}`),
  rest(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`),
  gql(`{plays(sport:"nfl",season:"${season}",season_type:"regular",week:${week}){
        sequence play_stats{player_id stats}}}`),
]);
const scoring = league.scoring_settings;
const players = JSON.parse(readFileSync(path.join(ROOT, 'data/sleeper_players.json'), 'utf8')).players;

const plays = playData.plays.slice().sort((a, b) => a.sequence - b.sequence);
console.log(`plays: ${plays.length}`);

// Replay in sequence, exactly as a live feed would see them.
const running = {}, points = {};
for (const play of plays) {
  for (const s of play.play_stats ?? []) {
    const pid = s.player_id;
    const pos = players[pid]?.position ?? null;
    const before = running[pid] ?? {};
    points[pid] = (points[pid] ?? 0) + scorePlayForPlayer(s.stats ?? {}, before, pos, scoring).total;
    running[pid] = addStats(before, s.stats ?? {});
  }
}

const OFFENCE = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
const round = n => Math.round(n * 100) / 100;
const offence = [], defence = [];
for (const pid of Object.keys(points)) {
  const p = players[pid];
  if (!p || !official[pid]) continue;
  const row = {
    name: p.full_name ?? pid, pos: p.position,
    replay: round(points[pid]), official: round(scoreStatLine(official[pid], scoring)),
  };
  row.diff = round(row.replay - row.official);
  (OFFENCE.has(p.position) ? offence : p.position === 'DEF' ? defence : []).push?.(row);
}

const wrong = offence.filter(r => Math.abs(r.diff) > 0.011);
offence.sort((a, b) => b.official - a.official);
console.log('\ntop scorers (replayed vs official):');
console.log('  ' + 'player'.padEnd(24) + 'pos'.padEnd(5) + 'replay'.padStart(9) + 'official'.padStart(10) + 'diff'.padStart(8));
for (const r of offence.slice(0, 10)) {
  console.log('  ' + r.name.slice(0, 23).padEnd(24) + r.pos.padEnd(5)
    + r.replay.toFixed(2).padStart(9) + r.official.toFixed(2).padStart(10)
    + (r.diff >= 0 ? '+' : '') + r.diff.toFixed(2).padStart(7));
}

console.log(`\nOFFENCE + K: ${offence.length - wrong.length}/${offence.length} exact `
  + `(${(100 * (offence.length - wrong.length) / offence.length).toFixed(1)}%)`);
if (wrong.length) {
  console.log('  disagreements:');
  for (const r of wrong.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 15)) {
    console.log(`    ${r.name.padEnd(22)} ${r.pos}  replay ${r.replay.toFixed(2)}  official ${r.official.toFixed(2)}  diff ${r.diff.toFixed(2)}`);
  }
}
console.log(`\nTEAM DEF: ${defence.length} teams, expected to disagree — the play feed is offence-only.`);
console.log('  Defensive points must come from the periodic stats feed, not from plays.');

rmSync(OUT, { recursive: true, force: true });
if (wrong.length) {
  console.log('\nFAILED: an offensive player disagreed by more than a cent.');
  process.exit(1);
}
console.log('\nPASSED: every offensive player reconciles to the cent.');

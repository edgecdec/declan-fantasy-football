/**
 * Test runner: compile TypeScript, fix up path aliases, hand off to `node --test`.
 *
 * Deliberately zero new dependencies. It uses the `typescript` already in devDeps and
 * Node's built-in test runner, so `npm test` adds nothing to the install the VPS has to
 * do on every deploy — that install has taken the site down twice, and a test framework
 * is not worth a third time. It also means CI needs no cache to be fast.
 *
 * The awkward part is that `tsc` emits `require("@/lib/...")` verbatim; TS path aliases
 * are a compile-time convenience Node knows nothing about. So after emitting we rewrite
 * each `@/x` specifier to a real relative path. Doing this by hand in a scratch
 * directory is exactly what made the previous rounds of verification unrepeatable, which
 * is the whole reason this file exists.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.test-build');
const SRC_ROOT = path.join(OUT, 'src');

rmSync(OUT, { recursive: true, force: true });

// noEmitOnError is false, so tsc emits even when it reports errors. Type errors are the
// business of `npm run typecheck`; this step only needs runnable JS.
try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.test.json'], { cwd: ROOT, stdio: 'pipe' });
} catch {
  // fall through — check below whether anything usable came out
}
if (!existsSync(OUT)) {
  console.error('run-tests: tsc produced no output; cannot run tests');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

const emitted = walk(OUT);
for (const file of emitted) {
  const before = readFileSync(file, 'utf8');
  // Resolve each alias against this file's own directory, rather than assuming a depth.
  const after = before.replace(/(['"])@\/([^'"]+)\1/g, (_m, q, rest) => {
    let rel = path.relative(path.dirname(file), path.join(SRC_ROOT, rest)).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${q}${rel}${q}`;
  });
  if (after !== before) writeFileSync(file, after);
}

const tests = emitted.filter(f => f.endsWith('.test.js'));
if (tests.length === 0) {
  console.error('run-tests: no compiled *.test.js found under .test-build/tests');
  process.exit(1);
}

console.log(`run-tests: ${tests.length} test file(s)\n`);
try {
  execFileSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}

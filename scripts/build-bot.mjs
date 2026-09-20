/**
 * Compiles the Discord bot to plain CommonJS for Node.
 *
 * Reuses the approach in run-tests.mjs rather than adding tsx or a bundler: `tsc` emits
 * `require("@/lib/...")` verbatim because TypeScript path aliases are a compile-time fiction, so the
 * emitted JS is rewritten to real relative paths afterwards. One dependency fewer, and the bot runs
 * on exactly the Node the VPS has.
 *
 * ES2022 here against the app's ES2017, because this never ships to a browser and discord.js needs a
 * modern target. That is also why bot code cannot use BigInt literals if it is to pass the app's
 * `npm run typecheck`, which reads tsconfig.json — see bot/src/permissions.ts.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'bot', 'dist');
const SRC_ROOT = path.join(ROOT, 'src');

rmSync(OUT, { recursive: true, force: true });

try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.bot.json'], { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
  // noEmitOnError is false, so type errors still produce output. Report them and keep going; the
  // authoritative gate is `npm run typecheck`.
  const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
  if (out) console.error(out);
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

let emitted;
try {
  emitted = walk(OUT);
} catch {
  console.error('build-bot: tsc produced no output');
  process.exit(1);
}

let rewritten = 0;
for (const file of emitted) {
  const before = readFileSync(file, 'utf8');
  // Resolved against each file's own directory rather than assuming a depth.
  const after = before.replace(/(['"])@\/([^'"]+)\1/g, (_m, q, rest) => {
    let rel = path.relative(path.dirname(file), path.join(SRC_ROOT, rest)).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${q}${rel}${q}`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    rewritten += 1;
  }
}

const entry = path.join(OUT, 'bot', 'src', 'index.js');
console.log(`build-bot: ${emitted.length} file(s), ${rewritten} with rewritten aliases`);
console.log(`build-bot: entry ${path.relative(ROOT, entry)}`);

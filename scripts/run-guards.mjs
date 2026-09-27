#!/usr/bin/env node
// Runs the repository's guard scripts at once and reports every failure.
//
// They ran one after another behind 39 `npm run` calls, which was 22 s of every
// commit, and all of it was process start-up rather than checking. Each guard
// here names the regression it would catch: a guard that cannot say what it
// catches does not belong in a gate, and the test beside this file refuses an
// entry without one.
//
// Sets:
//   commit       correctness guards, run by pre-commit
//   land         correctness, style and environment, run by the merge gates
//   all          the same as land, run by CI through `npm run audit`
//   environment  the worktree checks alone, `npm run doctor`
//
// Usage: node scripts/run-guards.mjs [--set commit|land|all|environment] [--list | --json]
// `--guards <file.json>` swaps the list for a test's own, the way `--root` does in
// the lints.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const node = (script, ...args) => ['node', `scripts/${script}`, ...args];
const tsx = (script, ...args) => ['npx', 'tsx', `scripts/${script}`, ...args];

// correctness: a violation is a broken build, a wrong number or a crash.
// style: the code works either way, and the guard keeps it consistent.
// environment: the worktree this runs in is set up wrongly, not the code.
const GUARDS = [
  {
    name: 'check:expo',
    kind: 'correctness',
    cmd: node('check-expo-sdk.mjs'),
    catches: 'an Expo package on a different SDK major than expo, which breaks the native build',
  },
  {
    name: 'check:android-prebuild',
    kind: 'correctness',
    cmd: node('check-android-prebuild.mjs'),
    catches: 'the tracked Android build files losing the dev id, version, release signing or Google services a prebuild overwrites',
  },
  {
    name: 'config:sports:check',
    kind: 'correctness',
    cmd: tsx('generate-sport-taxonomy.ts', '--check'),
    catches: 'the generated sport taxonomy drifting from its Rust source',
  },
  {
    name: 'config:trend:check',
    kind: 'correctness',
    cmd: tsx('generate-trend-table.ts', '--check'),
    catches: 'the generated trend table drifting from its Rust source',
  },
  {
    name: 'ffi:reach',
    kind: 'correctness',
    cmd: tsx('ffi-usage-report.ts', '--check'),
    catches: 'an engine export no TypeScript caller reaches and no list accounts for',
  },
  {
    name: 'ffi:area-check',
    kind: 'correctness',
    cmd: tsx('ffi-usage-report.ts', '--check-areas'),
    catches: 'a feature area reaching engine exports beyond its ceiling, or a stale ceiling entry',
  },
  {
    name: 'crash:guard',
    kind: 'correctness',
    cmd: node('crash-guard-sweep.mjs'),
    catches: 'latent crashes: Math.max or Math.min over a possibly empty spread, a hook after an early return, an unguarded JSON.parse',
  },
  {
    name: 'lint:engine-bridge',
    kind: 'correctness',
    cmd: node('engine-event-bridge-audit.mjs'),
    catches: 'engine-derived data that nothing invalidates after a sync, the strength and wellness stale-data bugs',
  },
  {
    name: 'lint:render-engine-reads',
    kind: 'correctness',
    cmd: node('lint-render-engine-reads.mjs'),
    catches: 'a synchronous engine read in render, which blocks the JS thread every frame',
  },
  {
    name: 'lint:muscle-polygons',
    kind: 'correctness',
    cmd: node('generate-muscle-polygons.mjs', '--check'),
    catches: 'the generated muscle polygons drifting from their source drawing',
  },
  {
    name: 'lint:detector-ordering',
    kind: 'correctness',
    cmd: node('lint-detector-ordering.mjs'),
    catches: 'a public function returning a hash container, whose seed makes detection order differ run to run',
  },
  {
    name: 'lint:generated-files',
    kind: 'correctness',
    cmd: node('lint-generated-files.mjs'),
    catches: 'a generated file a fresh clone cannot regenerate going untracked',
  },
  {
    name: 'lint:engine-surface',
    kind: 'correctness',
    // Through npm, so the ceilings stay in the one place the ratchet tells you to
    // lower them.
    cmd: ['npm', 'run', '--silent', 'lint:engine-surface'],
    catches: 'a new direct engine call site or store, giving a fact a second reader',
  },
  {
    name: 'lint:submodule-pointer',
    kind: 'correctness',
    cmd: node('lint-submodule-pointer.mjs'),
    catches: 'the tracematch pointer and the submodule on disk disagreeing, so builds test the wrong detector',
  },
  {
    name: 'lint:tracematch-lockfile',
    kind: 'correctness',
    cmd: node('lint-tracematch-lockfile.mjs'),
    catches: "tracematch's standalone Cargo.lock naming another version than its manifest, which fails its CI publish after the next push",
  },
  {
    name: 'lint:engine-write-lock',
    kind: 'correctness',
    cmd: node('lint-engine-write-lock.mjs'),
    catches: 'a screen read moved onto the pooled reader going back to the write lock',
  },
  {
    name: 'lint:detect-recv',
    kind: 'correctness',
    cmd: node('lint-detect-recv.mjs'),
    catches: 'a detection recv that defaults away a refused or dead run, reading it as an empty catalogue',
  },
  {
    name: 'lint:maestro-ids',
    kind: 'correctness',
    cmd: node('lint-maestro-ids.mjs'),
    catches: 'a Maestro flow naming a testID no component renders',
  },
  {
    name: 'lint:observer-vtable',
    kind: 'correctness',
    cmd: node('lint-one-observer-vtable.mjs'),
    catches: 'a second binding installing the engine observer vtable, where the last writer silently wins',
  },
  {
    name: 'lint:foreign-converter',
    kind: 'correctness',
    cmd: node('lint-foreign-converter-cursor.mjs'),
    catches: 'a JavaScript-implemented object written through a cursor, which throws at the FFI',
  },
  {
    name: 'lint:ffi-throw-type',
    kind: 'correctness',
    cmd: node('lint-ffi-throw-type.mjs'),
    catches: 'an export throwing anything but VeloqError, which panics the bindings generator',
  },
  {
    name: 'lint:ffi-bigint',
    kind: 'correctness',
    cmd: node('lint-ffi-bigint.mjs'),
    catches: 'a record field TypeScript lifts as bigint, which JSON.stringify throws on in release',
  },
  {
    name: 'lint:decline-visible',
    kind: 'correctness',
    cmd: node('lint-decline-visible.mjs'),
    catches: 'a job that declines below warn level, which a release engine on a phone never logs',
  },
  {
    name: 'lint:trend-thresholds',
    kind: 'correctness',
    cmd: node('lint-trend-thresholds.mjs'),
    catches: 'a surface handing a trend call its own threshold or its own copy of the call, so two cards call the same week up and flat',
  },
  {
    name: 'lint:zero-warnings',
    kind: 'correctness',
    cmd: node('lint-zero-warnings.mjs'),
    catches: 'a commit raising --max-warnings beside the warnings that fill it',
  },
  {
    name: 'lint:jest-mocks',
    kind: 'correctness',
    cmd: node('lint-jest-mock-partial.mjs'),
    catches: 'a jest.mock factory that replaces a whole package, leaving every export it omits undefined for the rest of the suite',
  },
  {
    name: 'check:widget-theme',
    kind: 'correctness',
    cmd: tsx('gen-widget-theme.ts', '--check'),
    catches: 'the native widget theme drifting from the app tokens',
  },
  {
    name: 'lint:reachability',
    kind: 'style',
    cmd: node('reachability-audit.mjs'),
    catches: 'a module nothing imports, left behind after its caller went',
  },
  {
    name: 'lint:em-dashes',
    kind: 'style',
    cmd: node('lint-em-dashes.mjs'),
    catches: 'an em dash in prose or comments',
  },
  {
    name: 'lint:comment-line-refs',
    kind: 'style',
    cmd: node('lint-comment-line-refs.mjs'),
    catches: 'a comment citing a line number, which drifts',
  },
  {
    name: 'lint:au-spelling',
    kind: 'style',
    cmd: node('lint-au-spelling.mjs'),
    catches: 'American spelling in our own identifiers and prose',
  },
  {
    name: 'lint:audit-ids',
    kind: 'style',
    cmd: node('lint-audit-ids.mjs'),
    catches: 'a docket id in a comment, which rots',
  },
  {
    name: 'lint:feature-imports',
    kind: 'style',
    cmd: node('lint-feature-imports.mjs'),
    catches: 'a new deep import between features, past the recorded baseline',
  },
  {
    name: 'lint:window-dimensions',
    kind: 'style',
    cmd: node('lint-window-dimensions.mjs'),
    catches: 'a static Dimensions read that ignores rotation and split screen',
  },
  {
    name: 'lint:retired-names',
    kind: 'style',
    cmd: node('lint-retired-names.mjs'),
    catches: 'the removed activity retention path coming back by name, in the store, the engine or the stream window comment',
  },
  {
    name: 'lint:verdict-palette',
    kind: 'style',
    cmd: node('lint-verdict-palette.mjs'),
    catches: 'a verdict colour outside the shared palette',
  },
  {
    name: 'lint:mark-contrast',
    kind: 'style',
    cmd: node('lint-mark-contrast.mjs'),
    catches: 'success or warning used as a text, border or icon colour, below the contrast a mark needs',
  },
  {
    name: 'lint:press-feedback',
    kind: 'style',
    cmd: node('lint-press-feedback.mjs'),
    catches: 'a pressable with no pressed state',
  },
  {
    name: 'lint:rgba',
    kind: 'style',
    cmd: node('lint-rgba-literals.mjs'),
    catches: 'a colour literal outside the theme tokens',
  },
  {
    name: 'lint:hand-rolled-buttons',
    kind: 'style',
    cmd: node('lint-hand-rolled-buttons.mjs'),
    catches: 'a new hand-built button instead of the shared one',
  },
  {
    name: 'lint:module-link',
    kind: 'environment',
    cmd: node('lint-module-link.mjs'),
    catches: 'node_modules/veloqrs pointing at a third tree, so a build anywhere ships that tree\'s engine',
  },
  {
    name: 'lint:worktree-config',
    kind: 'environment',
    cmd: node('lint-worktree-config.mjs'),
    catches: 'core.bare or user.email a leaked test fixture wrote onto the main checkout',
  },
  {
    name: 'lint:cargo-config-reach',
    kind: 'environment',
    cmd: node('lint-cargo-config-reach.mjs'),
    catches: 'a worktree outside the directory whose cargo config caps jobs and names the corpus',
  },
];

const SETS = {
  commit: ['correctness'],
  land: ['correctness', 'style', 'environment'],
  all: ['correctness', 'style', 'environment'],
  environment: ['environment'],
};

function run(guard) {
  return new Promise((resolve) => {
    const [bin, ...args] = guard.cmd;
    const started = Date.now();
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ guard, code, output, ms: Date.now() - started }));
    child.on('error', (error) => resolve({ guard, code: 127, output: String(error), ms: 0 }));
  });
}

async function runAll(guards, limit) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < guards.length) results.push(await run(guards[next++]));
  }
  await Promise.all(Array.from({ length: Math.min(limit, guards.length) }, worker));
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'all';
  if (!SETS[set]) {
    console.error(`run-guards: unknown set "${set}", expected one of ${Object.keys(SETS).join(', ')}`);
    process.exit(2);
  }
  const source = argv.includes('--guards')
    ? JSON.parse(readFileSync(argv[argv.indexOf('--guards') + 1], 'utf8'))
    : GUARDS;
  const guards = source.filter((g) => SETS[set].includes(g.kind));
  if (argv.includes('--json')) {
    console.log(JSON.stringify(guards, null, 2));
    return;
  }
  if (argv.includes('--list')) {
    for (const g of guards) console.log(`${g.kind.padEnd(12)} ${g.name.padEnd(26)} ${g.catches}`);
    return;
  }

  // Half the cores: the guards share the box with Jest, tsc and ESLint in the
  // same hook.
  const limit = Math.max(2, Math.floor(availableParallelism() / 2));
  const started = Date.now();
  const results = await runAll(guards, limit);
  const failed = results.filter((r) => r.code !== 0);
  for (const r of failed) {
    console.error(`\n--- ${r.guard.name} failed (${r.guard.kind}), guarding against ${r.guard.catches}`);
    process.stderr.write(r.output.endsWith('\n') ? r.output : `${r.output}\n`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed.length > 0) {
    console.error(`\nrun-guards: ${failed.length} of ${results.length} ${set} guards failed in ${seconds} s`);
    process.exit(1);
  }
  console.log(`run-guards: ${results.length} ${set} guards passed in ${seconds} s`);
}

main();

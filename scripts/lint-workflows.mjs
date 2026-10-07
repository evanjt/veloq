#!/usr/bin/env node
// The rules that make CI on main a report worth reading, held over every
// workflow and composite action under .github.
//
// GitHub cannot refuse a push here, so what CI owes is a true account of main.
// Each rule below was met once and then lost again to an edit that every other
// gate passed: a cache written from a pull request pushes main's out of the
// 10 GB budget, a schedule re-runs an unchanged sha and re-reports it, a
// superseded push to main is cancelled and read as red, and a job left out of
// an aggregator is never reported at all.
//
//   caches     every cache write is gated on main, and no step saves in a post
//              step without a ref check (actions/cache, setup-node `cache:` or
//              its automatic package-manager cache, setup-ruby `bundler-cache`)
//   schedule   a scheduled workflow skips a sha it already measured, and a
//              skipped run reports the outcome that sha was measured at, from
//              the run history when the schedule is less often than daily
//   cancel     nothing that runs on a push to main cancels it for a newer one
//   aggregate  a `*-required` job needs and reads every other job, and
//              test.yml and build.yml each keep theirs
//   abi        a release APK is built for armeabi-v7a and arm64-v8a only, and the
//              App Bundle is its own gradle invocation, so no athlete downloads
//              an emulator architecture
//   entitlements  an iOS simulator app is built with ad-hoc signing on, and the
//              step that packages it refuses an app whose binary has no
//              __entitlements section, so the App Group is present under test
//   bench      test.yml type-checks the benches with `cargo check --benches`,
//              and nothing links them by `cargo bench` or `--benches` on
//              `cargo test` or `cargo build`
//   builds     each platform's native build lives in one reusable workflow,
//              build-android.yml or build-ios.yml, which only a workflow_call
//              starts, so a pull request, main, a tag and E2E build one way
//   calls      a call into a local reusable workflow names one that exists,
//              passes only the inputs it declares and every one it requires
//   rust       a compiled Rust library is saved to the cache directly after the
//              step that built it, gated on that step's own success, so a
//              later packaging failure discards nothing and a failed compile
//              saves nothing
//   keys       in a job that builds natively, every hashFiles() is taken before
//              the job writes into the checkout, so a compiled library, a
//              generated project or node_modules never keys a cache
//
// Usage: node scripts/lint-workflows.mjs [--root <dir>]

import { load } from 'js-yaml';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const ON_MAIN = "github.ref == 'refs/heads/main'";
const OFF_MAIN = "github.ref != 'refs/heads/main'";

/** Scheduled workflows allowed to re-run an unchanged sha, and why. */
const SCHEDULE_ALLOWED = {
  '.github/workflows/e2e.yml':
    'the daily sweep tests the default branch head and looks for drift in what the app talks to, which moves without a push',
};

/** Workflows that must keep an aggregator, since branch protection names it. */
const AGGREGATED = ['.github/workflows/test.yml', '.github/workflows/build.yml'];

/** The workflow that type-checks every bench, since nothing else builds one. */
const BENCH_CHECKED = '.github/workflows/test.yml';

/** The one native build definition per platform, reached through workflow_call. */
const BUILD_DEFINITIONS = [
  '.github/workflows/build-android.yml',
  '.github/workflows/build-ios.yml',
];

/** The commands that generate or compile the native app, and how to name each. */
const NATIVE_BUILDS = [
  [/\bexpo\s+prebuild\b/, 'expo prebuild'],
  [/\bgradlew\b.*\b(assemble|bundle)\w*/, 'a Gradle assemble or bundle'],
  [/\bxcodebuild\b.*\s-(workspace|project|scheme)\b/, 'xcodebuild'],
  [/\bbuild-rust\.js\b/, 'the Rust builder'],
  [/\bgradlew\b.*\bbuildRustLibrary\b/, 'the Rust builder'],
  [/\bpod\s+install\b/, 'pod install'],
  [/\bfastlane\s+\w+\s+build_\w+/, 'a fastlane build lane'],
];

const failures = [];
const fail = (file, where, message) =>
  failures.push(`${file}${where ? ` (${where})` : ''}: ${message}`);

const action = (step) => (typeof step.uses === 'string' ? step.uses.split('@')[0] : '');
const text = (value) => (value === undefined || value === null ? '' : String(value));

/**
 * The expression with every parenthesised group that does not hold `ref`
 * folded to a placeholder, so an operator inside `(a || b)` beside the ref
 * check is not read as widening it.
 */
function outerLevel(expression, ref) {
  let e = text(expression).replace(/\$\{\{|\}\}/g, ' ');
  for (;;) {
    const next = e.replace(/\(([^()]*)\)/g, (_group, inner) =>
      inner.includes(ref) ? inner : ' _ '
    );
    if (next === e) return e;
    e = next;
  }
}

/** A write gate: true on main and nowhere else, so no || beside the ref check. */
function writesOnlyOnMain(expression) {
  const e = outerLevel(expression, ON_MAIN);
  return e.includes(ON_MAIN) && !e.includes('||');
}

/** A read-only gate: true everywhere but main, so no && beside the ref check. */
function readOnlyOffMain(expression) {
  const e = outerLevel(expression, OFF_MAIN);
  return e.includes(OFF_MAIN) && !e.includes('&&');
}

/**
 * The cargo invocations in a run script, one per command, so a flag is read
 * against the subcommand it belongs to.
 */
function cargoCommands(run) {
  return text(run)
    .replace(/\\\r?\n/g, ' ')
    .split(/\n|&&|\|\||;/)
    .map((command) => command.match(/\bcargo\s+(?:\+\S+\s+)?(\S+)(.*)/))
    .filter(Boolean)
    .map(([, subcommand, rest]) => ({ subcommand, rest }));
}

const benchesFlag = (rest) => /(^|\s)--benches(\s|$)/.test(rest);
const allTargetsFlag = (rest) => /(^|\s)--all-targets(\s|$)/.test(rest);
const LINKING_SUBCOMMANDS = ['test', 'build', 'nextest'];
// The conditions a step that re-reports a measured sha runs on: a cache hit, a
// restore-keys match (where cache-hit is false), or an outcome read from the
// run history.
const REPORT_CONDITION =
  /steps\.[\w-]+\.outputs\.(?:cache-hit\s*==\s*'true'|cache-matched-key\s*!=\s*''|outcome\s*!=\s*'')/;

/** A cancel gate: false on main, so no || beside the ref check. */
function neverCancelsMain(expression) {
  const e = outerLevel(expression, OFF_MAIN);
  return e.includes(OFF_MAIN) && !e.includes('||');
}

/** The native build a run script performs, by name, or null when it performs none. */
function nativeBuild(run) {
  const lines = text(run)
    .replace(/\\\r?\n/g, ' ')
    .split('\n');
  for (const [pattern, name] of NATIVE_BUILDS) {
    if (lines.some((line) => pattern.test(line))) return name;
  }
  return null;
}

/**
 * Whether a step writes into the workspace beyond the checkout: a native
 * build, an npm install, or a cache restored to a path inside the workspace.
 */
function writesWorkspace(step) {
  if (nativeBuild(step.run) !== null) return true;
  if (/\bnpm\s+(ci|install)\b/.test(text(step.run))) return true;
  if (action(step) === './.github/actions/npm-ci') return true;
  if (action(step) === 'actions/cache/restore') {
    return text(step.with?.path)
      .split('\n')
      .map((line) => line.trim())
      .some((path) => path !== '' && !/^[~/$!]/.test(path));
  }
  return false;
}

function checkKeys(file, id, steps) {
  if (!steps.some((step) => nativeBuild(step.run) !== null)) return;
  const first = steps.findIndex(writesWorkspace);
  if (first === -1) return;
  steps.slice(first + 1).forEach((step, i) => {
    if (JSON.stringify(step).includes('hashFiles(')) {
      fail(
        file,
        `job ${id} step ${step.name ?? step.uses ?? first + i + 2}`,
        `hashFiles() runs after ${steps[first].name ?? 'a step'} wrote into the checkout, so what it wrote can key the cache. Hash the inputs in a step before it.`
      );
    }
  });
}

const RUST_PRODUCER = /\b(build-rust\.js|buildRustLibrary)\b/;
const isRustProducer = (step) => RUST_PRODUCER.test(text(step.run));
const isRustSave = (step) =>
  action(step) === 'actions/cache/save' && /build\/rust/.test(text(step.with?.path));

/**
 * A run of consecutive steps that compile the Rust library is followed at
 * once by the step that saves it, gated on every one of them having
 * succeeded. A save left to the end of the job is skipped by any later
 * failure, and the next run compiles again what already compiled.
 */
function checkRustSaves(file, id, steps) {
  const label = (i) => `job ${id} step ${steps[i].name ?? steps[i].uses ?? i + 1}`;
  const covered = new Set();
  for (let i = 0; i < steps.length; i++) {
    if (!isRustProducer(steps[i])) continue;
    let end = i;
    while (isRustProducer(steps[end + 1] ?? {})) end++;
    const ids = steps.slice(i, end + 1).map((step) => step.id);
    const save = steps[end + 1];
    if (!save || !isRustSave(save)) {
      fail(
        file,
        label(i),
        'the compiled Rust library is never saved directly after this step, so a later failure discards it and the next run compiles it again. Follow it with an actions/cache/save of its output.'
      );
    } else {
      covered.add(end + 1);
      const gate = text(save.if);
      const missing = ids.filter(
        (stepId) => !stepId || !gate.includes(`steps.${stepId}.outcome == 'success'`)
      );
      if (missing.length > 0) {
        fail(
          file,
          label(end + 1),
          "saves the Rust library when the whole job succeeds or on a step that did not build it. Gate it on steps.<id>.outcome == 'success' for each step that built it, so it is saved only when the step that built them succeeded."
        );
      }
    }
    i = end;
  }
  steps.forEach((step, i) => {
    if (isRustSave(step) && !covered.has(i)) {
      fail(
        file,
        label(i),
        'saves the Rust library away from the step that built it. Place it directly after that step.'
      );
    }
  });
}

function checkStep(file, where, step, isBenchWorkflow, isDefinition = false) {
  const uses = action(step);
  const w = step.with ?? {};
  const build = nativeBuild(step.run);
  if (build !== null && !isDefinition) {
    fail(
      file,
      where,
      `${build} runs outside the shared build definitions. Call ${BUILD_DEFINITIONS.join(' or ')} instead.`
    );
  }

  if (uses === 'actions/cache') {
    fail(
      file,
      where,
      `actions/cache saves in a post step from any ref. Use actions/cache/restore and an actions/cache/save gated on ${ON_MAIN}.`
    );
  }
  if (uses === 'actions/cache/save' && !writesOnlyOnMain(step.if)) {
    fail(file, where, `actions/cache/save runs off main. Its if: needs ${ON_MAIN}, with no ||.`);
  }
  if (uses === 'Swatinem/rust-cache' && !writesOnlyOnMain(w['save-if'])) {
    fail(file, where, `Swatinem/rust-cache saves off main. Set save-if: \${{ ${ON_MAIN} }}.`);
  }
  if (uses === 'hendrikmuhs/ccache-action' && !writesOnlyOnMain(w.save)) {
    fail(file, where, `ccache-action saves off main. Set save: \${{ ${ON_MAIN} }}.`);
  }
  if (
    (uses === 'gradle/actions/setup-gradle' || uses === 'gradle/gradle-build-action') &&
    text(w['cache-disabled']) !== 'true' &&
    !readOnlyOffMain(w['cache-read-only'])
  ) {
    fail(
      file,
      where,
      `setup-gradle writes its cache off main. Set cache-read-only: \${{ ${OFF_MAIN} }}.`
    );
  }
  if (
    (uses === 'gradle/actions/setup-gradle' || uses === 'gradle/gradle-build-action') &&
    text(w['cache-disabled']) !== 'true' &&
    !['on-success', 'always'].includes(text(w['cache-cleanup']))
  ) {
    fail(
      file,
      where,
      "setup-gradle saves main's Gradle home with every retired dependency in it. Set cache-cleanup: on-success."
    );
  }
  if (uses === 'actions/setup-node' && text(w['package-manager-cache']) !== 'false') {
    fail(
      file,
      where,
      'actions/setup-node caches npm in a post step from any ref once package.json names npm. Set package-manager-cache: false.'
    );
  }
  if (uses === 'actions/setup-go' && text(w.cache) !== 'false') {
    fail(
      file,
      where,
      'actions/setup-go caches Go modules in a post step from any ref by default. Set cache: false.'
    );
  } else if (
    /^actions\/setup-(node|python|java)$/.test(uses) &&
    text(w.cache) !== '' &&
    text(w.cache) !== 'false'
  ) {
    fail(
      file,
      where,
      `${uses} with cache: saves in a post step from any ref. Use .github/actions/npm-ci, or a restore and a save gated on main.`
    );
  }
  if (uses === 'ruby/setup-ruby' && text(w['bundler-cache']) === 'true') {
    fail(
      file,
      where,
      'setup-ruby with bundler-cache saves in a post step from any ref. Use .github/actions/setup-fastlane.'
    );
  }
  checkReleaseApk(file, where, step);
  checkSimulatorEntitlements(file, where, step);
  if (!isBenchWorkflow && /\bcargo\s+(\+\S+\s+)?bench\b/.test(text(step.run))) {
    fail(
      file,
      where,
      'cargo bench links every bench under the release profile. Type-check them with cargo check --benches.'
    );
  }
  const commands = cargoCommands(step.run);
  if (
    commands.some(
      ({ subcommand, rest }) => LINKING_SUBCOMMANDS.includes(subcommand) && benchesFlag(rest)
    )
  ) {
    fail(
      file,
      where,
      'cargo test, build or nextest with --benches links every bench. Type-check them with cargo check --benches.'
    );
  }
  if (
    commands.some(
      ({ subcommand, rest }) => LINKING_SUBCOMMANDS.includes(subcommand) && allTargetsFlag(rest)
    )
  ) {
    fail(
      file,
      where,
      'cargo test, build or nextest with --all-targets links every bench. Type-check them with cargo check --benches.'
    );
  }
  const checksBenches = commands.some(
    ({ subcommand, rest }) => subcommand === 'check' && benchesFlag(rest)
  );
  if (
    text(step['continue-on-error']) !== '' &&
    text(step['continue-on-error']) !== 'false' &&
    (checksBenches || REPORT_CONDITION.test(text(step.if)))
  ) {
    fail(
      file,
      where,
      'continue-on-error on the bench check or on a step that re-reports a measured sha turns its failure into a pass. Remove it.'
    );
  }
  if (/\bexit\s+[1-9]\d*\s*\|\|\s*true\b/.test(text(step.run))) {
    fail(file, where, 'exit followed by || true never fails the step. Remove the || true.');
  }
}

/**
 * A release APK step is one gated on RELEASE_BUILD that runs assembleRelease.
 * It must name its architectures and leave out the emulator ones, and the
 * bundle, which Play splits per device, is built by a step of its own.
 */
function checkReleaseApk(file, where, step) {
  const run = text(step.run);
  if (!/\bassembleRelease\b/.test(run) || !text(step.if).includes("env.RELEASE_BUILD == 'true'")) {
    return;
  }
  const archs = run.match(/-PreactNativeArchitectures=(\S+)/)?.[1];
  if (archs === undefined || /\bx86/.test(archs)) {
    fail(
      file,
      where,
      'the release APK carries an emulator architecture. Pass -PreactNativeArchitectures=armeabi-v7a,arm64-v8a.'
    );
  }
  if (/\bbundleRelease\b/.test(run)) {
    fail(
      file,
      where,
      'bundleRelease shares this invocation, so the bundle takes the APK architectures. Build it in its own step.'
    );
  }
}

/**
 * A simulator build with signing switched off embeds no entitlements, so the
 * App Group, the shared keychain group and the extensions' containers are
 * absent. The build must sign ad hoc, and the step that zips the app must
 * check the section.
 */
function checkSimulatorEntitlements(file, where, step) {
  const run = text(step.run);
  if (/\bxcodebuild\b/.test(run) && /-sdk\s+iphonesimulator\b/.test(run)) {
    if (!/\bCODE_SIGNING_ALLOWED=YES\b/.test(run)) {
      fail(
        file,
        where,
        'the simulator app is built without ad-hoc signing, so it carries no entitlements. Pass CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM=.'
      );
    }
  }
  if (
    /(^|\s)zip\s/.test(run) &&
    /Release-iphonesimulator/.test(run) &&
    !/__entitlements/.test(run)
  ) {
    fail(
      file,
      where,
      'the simulator app is packaged without checking its binary for an __entitlements section (otool -l), so an unsigned build ships unnoticed.'
    );
  }
}

function checkBenchesChecked(file, workflow) {
  if (file !== BENCH_CHECKED) return;
  const runs = Object.values(workflow.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).map((step) => step.run)
  );
  const checked = runs.some((run) =>
    cargoCommands(run).some(({ subcommand, rest }) => subcommand === 'check' && benchesFlag(rest))
  );
  if (!checked) {
    fail(
      file,
      'jobs',
      'no step runs cargo check --benches, so a bench rots behind any signature change and nothing says so.'
    );
  }
}

function stepsOf(file, steps, prefix, isBenchWorkflow, isDefinition = false) {
  (steps ?? []).forEach((step, i) => {
    checkStep(
      file,
      `${prefix}step ${step.name ?? step.uses ?? i + 1}`,
      step,
      isBenchWorkflow,
      isDefinition
    );
  });
}

function checkDefinition(file, triggers) {
  if (!BUILD_DEFINITIONS.includes(file)) return;
  const others = Object.keys(triggers).filter((t) => t !== 'workflow_call');
  if (!('workflow_call' in triggers) || others.length > 0) {
    fail(
      file,
      'on',
      `a build definition starts only from workflow_call, so every entrypoint builds through it. Found: ${Object.keys(triggers).join(', ') || 'none'}.`
    );
  }
}

/** A job calling a local reusable workflow passes what that workflow declares. */
function checkCall(file, id, job, workflows) {
  const target = text(job.uses).replace(/^\.\//, '').split('@')[0];
  if (!target.startsWith('.github/workflows/')) return;
  const called = workflows.get(target);
  const call = called && triggersOf(called).workflow_call;
  if (!called || call === undefined) {
    fail(
      file,
      `job ${id}`,
      `calls ${target}, which is not a workflow with a workflow_call trigger.`
    );
    return;
  }
  const inputs = (call ?? {}).inputs ?? {};
  const given = Object.keys(job.with ?? {});
  for (const name of given.filter((n) => !(n in inputs))) {
    fail(file, `job ${id}`, `passes ${name}, which ${target} does not declare.`);
  }
  for (const [name, spec] of Object.entries(inputs)) {
    if (spec?.required === true && spec.default === undefined && !given.includes(name)) {
      fail(file, `job ${id}`, `leaves out ${name}, which ${target} requires.`);
    }
  }
  if (job.secrets && typeof job.secrets === 'object') {
    const secrets = (call ?? {}).secrets ?? {};
    for (const name of Object.keys(job.secrets).filter((n) => !(n in secrets))) {
      fail(file, `job ${id}`, `passes the secret ${name}, which ${target} does not declare.`);
    }
  }
}

function triggersOf(workflow) {
  // js-yaml reads a bare `on:` key as the boolean true.
  const on = workflow.on ?? workflow[true];
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((t) => [t, {}]));
  return on ?? {};
}

function runsOnMainPush(triggers) {
  if (!('push' in triggers)) return false;
  const push = triggers.push ?? {};
  if (!push.branches && !push.tags) return true;
  return (push.branches ?? []).some((b) => b === 'main' || b === '**' || b === '*');
}

function checkCancel(file, where, concurrency) {
  if (!concurrency || typeof concurrency !== 'object') return;
  const cancel = concurrency['cancel-in-progress'];
  if (cancel === undefined || cancel === false || text(cancel) === 'false') return;
  if (!neverCancelsMain(cancel)) {
    fail(
      file,
      where,
      `cancel-in-progress cancels a push to main for a newer one, which the aggregator then reads as red. Use \${{ ${OFF_MAIN} }}.`
    );
  }
}

/**
 * Why a measured-sha skip cannot stand, or null when it can. A skipped job
 * concludes success, so the skip has to carry the outcome the sha was
 * measured at and fail the run on anything but success, or a sha measured
 * red reads green from the next scheduled run on.
 */
const recordBase = (key) =>
  text(key)
    .replace(/-?\$\{\{\s*github\.run_id\s*\}\}.*$/, '')
    .replace(/-$/, '');

function skipProblem(steps, lookup) {
  const path = text(lookup.with?.path);
  const prefix = text(lookup.with?.['restore-keys']).trim();
  const saves = steps.filter(
    (s) =>
      action(s) === 'actions/cache/save' && recordBase(s.with?.key) === recordBase(lookup.with?.key)
  );
  if (prefix === '' || saves.length === 0) {
    return 'the measured-sha record is looked up by its exact key, and an Actions cache entry cannot be overwritten, so a re-run by hand cannot supersede a sha measured red. Save under the sha and the run id, and restore with restore-keys on the sha prefix.';
  }
  if (!saves.some((s) => text(s.with.key).includes('github.run_id'))) {
    return 'the measured-sha record is saved under a key a later run cannot supersede, so a re-run by hand cannot clear a sha measured red. Add github.run_id to the save key.';
  }
  if (text(lookup.with?.['lookup-only']) === 'true') {
    return 'the measured-sha lookup is lookup-only, so it cannot read back a sha measured red, and the skipped run reads green. Restore the record.';
  }
  const outcomeFiles = steps.flatMap((s) =>
    [...text(s.run).matchAll(/steps\.[\w-]+\.outcome[^\n]*>\s*(\S+)/g)]
      .map(([, target]) => target)
      .filter((target) => path !== '' && target.startsWith(`${path}/`))
  );
  if (outcomeFiles.length === 0) {
    return `the record in ${path} holds no outcome, so a skip cannot tell a sha measured red from one measured green. Write the measuring step's outcome into it.`;
  }
  const recorded = steps
    .filter((s) => /steps\.[\w-]+\.outcome[^\n]*>/.test(text(s.run)))
    .map((s) => text(s.run))
    .join('\n');
  const skipped = `steps.${text(lookup.id)}.outputs.cache-matched-key == ''`;
  const unrecorded = steps.filter(
    (s) =>
      text(s.if).includes(skipped) &&
      text(s.run) !== '' &&
      !(s.id !== undefined && recorded.includes(`steps.${s.id}.outcome`))
  );
  if (lookup.id !== undefined && unrecorded.length > 0) {
    const names = unrecorded.map((s) => s.name ?? s.id ?? s.run).join(', ');
    return `the outcome in ${path} leaves out ${names}, so a sha that failed there reads green once skipped. Give each an id and fold its outcome into the record.`;
  }
  const hit = `steps.${text(lookup.id)}.outputs.cache-matched-key != ''`;
  const reReports = steps.some(
    (s) =>
      lookup.id !== undefined &&
      text(s.if).includes(hit) &&
      outcomeFiles.some((target) => text(s.run).includes(target)) &&
      /\bexit\s+[1-9]/.test(text(s.run))
  );
  if (!reReports) {
    return `no step on ${hit} (cache-hit is false on a restore-keys match) reads the outcome written to ${outcomeFiles.join(', ')} and fails, so a skip reads green on a sha measured red.`;
  }
  return null;
}

const HISTORY_SCRIPT = 'scripts/earlier-outcome.mjs';

/** True when a cron expression fires on fewer than every day. */
function lessOftenThanDaily(cron) {
  const [, , dayOfMonth, month, dayOfWeek] = text(cron).trim().split(/\s+/);
  return [dayOfMonth, month, dayOfWeek].some((field) => field !== '*');
}

/**
 * Why a record read from the run history cannot stand, or null when it can.
 * The measuring step's own conclusion is the record, so the lookup has to be
 * able to read the runs and a step has to fail on anything but success.
 */
function historyProblem(workflow, steps, lookup) {
  const permissions = [
    workflow.permissions,
    ...Object.values(workflow.jobs ?? {}).map((j) => j.permissions),
  ];
  if (!permissions.some((p) => p && typeof p === 'object' && text(p.actions) === 'read')) {
    return 'the run history cannot be read without actions: read in permissions, so the lookup finds no earlier run and every week measures again.';
  }
  const reported = `steps.${text(lookup.id)}.outputs.`;
  const reReports = steps.some(
    (s) =>
      lookup.id !== undefined && text(s.if).includes(reported) && /\bexit\s+[1-9]/.test(text(s.run))
  );
  if (!reReports) {
    return `no step on ${reported}* reads the outcome from the run history and fails, so a skip reads green on a sha measured red.`;
  }
  return null;
}

function checkSchedule(file, workflow, triggers) {
  if (!('schedule' in triggers) || file in SCHEDULE_ALLOWED) return;
  const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
  const history = steps.filter((s) => text(s.run).includes(HISTORY_SCRIPT));
  if (history.length > 0) {
    const problems = history.map((lookup) => historyProblem(workflow, steps, lookup));
    if (!problems.includes(null)) fail(file, 'on.schedule', problems[0]);
    return;
  }
  const lookups = steps.filter(
    (s) =>
      action(s) === 'actions/cache/restore' &&
      text(s.with?.key).includes('github.sha') &&
      steps.some(
        (save) =>
          action(save) === 'actions/cache/save' &&
          recordBase(save.with?.key) === recordBase(s.with.key)
      )
  );
  if (lookups.length === 0) {
    fail(
      file,
      'on.schedule',
      `a schedule with no measured-sha skip re-runs an unchanged sha and re-reports it. Restore a record keyed on github.sha and save it once measured, as rust-coverage.yml does, or read the run history with ${HISTORY_SCRIPT}.`
    );
    return;
  }
  const slow = (triggers.schedule ?? []).find((t) => lessOftenThanDaily(t.cron));
  if (slow) {
    fail(
      file,
      'on.schedule',
      `a cache entry is evicted after seven days or sooner under a full store, so a record kept there lapses on a schedule that runs less often than daily (${text(slow.cron)}). Read the run history with ${HISTORY_SCRIPT} instead.`
    );
    return;
  }
  const problems = lookups.map((lookup) => skipProblem(steps, lookup));
  if (!problems.includes(null)) fail(file, 'on.schedule', problems[0]);
}

function checkAggregators(file, workflow) {
  const jobs = workflow.jobs ?? {};
  const ids = Object.keys(jobs);
  const aggregators = ids.filter((id) => id.endsWith('-required'));
  if (AGGREGATED.includes(file) && aggregators.length === 0) {
    fail(file, 'jobs', 'has no *-required aggregator, and branch protection names one.');
  }
  for (const id of aggregators) {
    const job = jobs[id];
    const needs = [job.needs ?? []].flat();
    if (!text(job.if).includes('always()')) {
      fail(
        file,
        `job ${id}`,
        'an aggregator without if: always() is skipped when a job fails, and a skipped check reads as passing.'
      );
    }
    const body = JSON.stringify(job.steps ?? []);
    for (const other of ids.filter((o) => !aggregators.includes(o))) {
      if (!needs.includes(other)) {
        fail(file, `job ${id}`, `does not need ${other}, so its result is never reported.`);
      } else if (!body.includes(`needs.${other}.result`)) {
        fail(file, `job ${id}`, `needs ${other} and never reads needs.${other}.result.`);
      }
    }
  }
}

const sources = indexedSources(root, ['.github/workflows', '.github/actions']);
refuseEmptyListing(sources, 'Workflow guard');

const parsed = new Map();
for (const [file, bytes] of sources) {
  const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
  const isAction = /^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(file);
  if (!isWorkflow && !isAction) continue;
  try {
    const doc = load(bytes.toString('utf8'));
    if (doc && typeof doc === 'object') parsed.set(file, { doc, isAction });
  } catch (error) {
    fail(file, '', `does not parse: ${error.message.split('\n')[0]}`);
  }
}
const workflows = new Map(
  [...parsed].filter(([, { isAction }]) => !isAction).map(([file, { doc }]) => [file, doc])
);

for (const [file, { doc, isAction }] of parsed) {
  if (isAction) {
    stepsOf(file, doc.runs?.steps, '', false);
    continue;
  }

  const isBenchWorkflow = /bench/.test(file);
  const isDefinition = BUILD_DEFINITIONS.includes(file);
  const triggers = triggersOf(doc);
  const onMain = runsOnMainPush(triggers);
  if (onMain) checkCancel(file, 'concurrency', doc.concurrency);
  checkDefinition(file, triggers);
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    if (onMain) checkCancel(file, `job ${id} concurrency`, job.concurrency);
    stepsOf(file, job.steps, `job ${id} `, isBenchWorkflow, isDefinition);
    checkKeys(file, id, job.steps ?? []);
    checkRustSaves(file, id, job.steps ?? []);
    checkCall(file, id, job, workflows);
  }
  checkSchedule(file, doc, triggers);
  checkAggregators(file, doc);
  checkBenchesChecked(file, doc);
}

if (failures.length > 0) {
  console.error(
    `Workflow guard: ${failures.length} rule${failures.length === 1 ? '' : 's'} broken.\n`
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  'Workflow guard: caches write from main only, no schedule re-runs a sha, every job is reported, each platform builds in one place.'
);

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
//   aggregate  a `*-required` job needs and reads every other job, reads the
//              outputs any of them is gated on, and test.yml and build.yml
//              each keep theirs
//   gradle     every gradlew call passes --build-cache, since Gradle leaves its
//              build cache off without it and every task reruns on a warm runner
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
//              starts, so a pull request, main, a tag and E2E build one way;
//              the code scan alone may generate the Android project, to compile
//              under CodeQL's tracer, and packages nothing
//   calls      a call into a local reusable workflow names one that exists,
//              passes only the inputs it declares and every one it requires
//   rust       a compiled Rust library is saved to the cache directly after the
//              step that built it, gated on that step's own success, so a
//              later packaging failure discards nothing and a failed compile
//              saves nothing
//   keys       in a job that builds natively, every hashFiles() is taken before
//              the job writes into the checkout, so a compiled library, a
//              generated project or node_modules never keys a cache
//   profile    workflows build the shipped Rust profile, including E2E builds
//   identity   every artifact a build definition uploads is preceded by
//              `build-record.js identity --variant`, and one such check runs
//              on a cache hit too, so a restored or mixed-identity artifact is
//              judged on its contents before it leaves the job
//   variant    a job that builds natively in a definition takes APP_VARIANT
//              from inputs.variant in its own or the workflow's env, and no
//              step sets it, since Gradle, the bundler and fastlane read the
//              Expo configuration again after prebuild
//   node       every setup-node reads its version from .nvmrc and no step
//              passes a node-version, so CI builds under the major local
//              builds are checked against, and package.json engines.node
//              holds that same major
//   advisories test.yml runs `cargo audit --deny warnings`, in a step of its own
//              or through a local workflow it calls, and a scheduled workflow
//              runs it too, since an advisory is published against a lockfile
//              that has not changed
//   deploys    a workflow only a tag starts never skips a store deploy: no step sets
//              `skip=true` for a missing credential and no job runs only when an
//              earlier job found its artefact, so a green run means an upload
//   pods       CocoaPods comes from the fastlane bundle, which pins one exact
//              version and locks that version: no step runs `gem install
//              cocoapods`, every `pod` runs as `bundle exec pod` against that
//              Gemfile, and no pod failure is swallowed. CI otherwise installs
//              whatever release is newest, which the Podfile.lock the machines
//              write never named
//   runners    no job runs on a floating `-latest` label, directly, in a label
//              list or through its matrix, since the hosted image under one
//              moves on GitHub's date and can change a toolchain the generated
//              bindings or a release build depend on with no commit here
//   pinned     every action and reusable workflow from outside this repository
//              and GitHub's own actions/* is pinned to a full commit sha, since
//              a tag or branch moves at the will of whoever holds that repository
//              and the release jobs hand these steps the signing keys
//   runtimes   no step pins an action at a version whose runtime is Node 20,
//              which the runner has deprecated and forces onto Node 24, a sha
//              pin judged by the tag in its trailing comment
//   shards     a `--shard=I/N` takes I from a matrix key whose values are 1 to N,
//              each once, since a count past the list or a fixed index leaves
//              part of the suite unrun and every shard that did run reads green
//   splice     no `run:` body and no action's `script:` input expands
//              `inputs.*`, `github.event.*` or `github.head_ref` in place,
//              since the runner pastes the value into the shell text before
//              it starts and a dispatch or pull request value runs as commands;
//              the step passes it through `env:` and reads it quoted instead
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
  '.github/workflows/rust-advisories.yml':
    'the advisory database moves without a push, so an unchanged lockfile is scanned again against it',
  '.github/workflows/codeql.yml':
    'the query packs move without a push, so an unchanged sha is scanned again with newer queries',
};

/** Workflows that must keep an aggregator, since branch protection names it. */
const AGGREGATED = ['.github/workflows/test.yml', '.github/workflows/build.yml'];

/** The workflow that type-checks every bench, since nothing else builds one. */
const BENCH_CHECKED = '.github/workflows/test.yml';

/** The file every Node setup reads its version from, and the engines field echoes. */
const NODE_VERSION_FILE = '.nvmrc';

/** The workflow every change passes through, which must scan the Rust lockfile. */
const ADVISORY_SCANNED = '.github/workflows/test.yml';

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

/** Native build commands a workflow outside the definitions may run, and why. */
const NATIVE_BUILD_ALLOWED = {
  '.github/workflows/codeql.yml': {
    'expo prebuild': 'compiles the Kotlin and Java for CodeQL and packages nothing',
  },
};

/** The bundle CocoaPods is installed from, so CI and every machine run one version. */
const POD_GEMFILE = 'config/fastlane/Gemfile';
const POD_COMMAND = /(^|[\s;&|(])pod\s+[a-z]/;
const GEM_INSTALL_PODS = /\bgem\s+install\b[^\n;&|]*\bcocoapods\b/;

/** Set once any step runs pod, which is when the bundle has to pin it. */
let podsRun = false;

/**
 * The first version of each action whose action.yml declares `using: node24`,
 * read from each tag's action.yml. Every version before it declares node20. A
 * sha pin is judged by the tag in its trailing comment, and a ref that names no
 * version is not judged.
 */
const FIRST_NODE24 = {
  'actions/checkout': '5',
  'actions/cache': '5',
  'actions/cache/restore': '5',
  'actions/cache/save': '5',
  'actions/upload-artifact': '6',
  'actions/download-artifact': '7',
  'actions/setup-java': '5',
  'actions/setup-node': '5',
  'actions/setup-go': '6',
  'dorny/paths-filter': '4',
  'dependabot/fetch-metadata': '3',
  'hendrikmuhs/ccache-action': '1.2.21',
};

/** A version ref's numbers, or null for a ref that is not a version. */
function versionOf(ref) {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(ref);
  return match ? match[1].split('.').map(Number) : null;
}

/** The tag in each sha pin's trailing comment, keyed on the pinned ref. */
const PIN_TAGS = new Map();
const PIN_COMMENT = /^\s*-?\s*uses:\s*['"]?([^\s'"#]+@[0-9a-f]{40})['"]?\s+#\s*(\S+)/gm;

/** The version a step's ref names, read from the comment when the ref is a sha. */
function refVersion(uses) {
  const ref = uses.split('@')[1] ?? '';
  return versionOf(FULL_SHA.test(ref) ? (PIN_TAGS.get(uses) ?? '') : ref);
}

/** Whether version a sorts before b, a missing number reading as 0. */
function before(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

const failures = [];
const fail = (file, where, message) =>
  failures.push(`${file}${where ? ` (${where})` : ''}: ${message}`);

const action = (step) => (typeof step.uses === 'string' ? step.uses.split('@')[0] : '');
const text = (value) => (value === undefined || value === null ? '' : String(value));

function checkRustProfile(file, where, env, run = '') {
  if (
    env &&
    Object.hasOwn(env, 'VELOQRS_RUST_PROFILE') &&
    text(env.VELOQRS_RUST_PROFILE) !== 'release'
  ) {
    fail(file, where, 'VELOQRS_RUST_PROFILE must be release in workflows.');
  }
  for (const match of text(run).matchAll(
    /\bVELOQRS_RUST_PROFILE\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g
  )) {
    if ((match[1] ?? match[2] ?? match[3]) !== 'release') {
      fail(file, where, 'VELOQRS_RUST_PROFILE must be release in workflows.');
    }
  }
  for (const match of text(run).matchAll(
    /-PveloqrsRustProfile\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g
  )) {
    if ((match[1] ?? match[2] ?? match[3]) !== 'release') {
      fail(file, where, 'veloqrsRustProfile must be release in workflows.');
    }
  }
}

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

/** Whether an environment hands CMake ccache as a compiler launcher. */
function launchesCcache(env) {
  return ['CMAKE_C_COMPILER_LAUNCHER', 'CMAKE_CXX_COMPILER_LAUNCHER'].some(
    (name) => text(env?.[name]) === 'ccache'
  );
}

/** The native builds a run script performs, by name, each once. */
function nativeBuilds(run) {
  const lines = text(run)
    .replace(/\\\r?\n/g, ' ')
    .split('\n');
  const names = NATIVE_BUILDS.filter(([pattern]) => lines.some((line) => pattern.test(line))).map(
    ([, name]) => name
  );
  return [...new Set(names)];
}

/**
 * Whether a step writes into the workspace beyond the checkout: a native
 * build, an npm install, or a cache restored to a path inside the workspace.
 */
function writesWorkspace(step) {
  if (nativeBuilds(step.run).length > 0) return true;
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
  if (!steps.some((step) => nativeBuilds(step.run).length > 0)) return;
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

/** A ref only the owner of the action's repository can move. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Local actions and GitHub's own actions/* are the only refs left on a tag. */
function checkPinned(file, where, uses) {
  if (typeof uses !== 'string' || uses.startsWith('./') || uses.startsWith('actions/')) return;
  const at = uses.lastIndexOf('@');
  if (at === -1 || !FULL_SHA.test(uses.slice(at + 1))) {
    fail(
      file,
      where,
      `${uses} is not pinned to a commit. Pin the full 40-character sha with the tag in a trailing comment.`
    );
  }
}

/** Caller-controlled text, which an expression pastes into the script verbatim. */
const SPLICED = /\$\{\{[^}]*?\b(inputs\.[\w-]+|github\.event\.[\w.-]+|github\.head_ref)\b/g;

function checkSpliced(file, where, field, body) {
  const names = [...new Set([...text(body).matchAll(SPLICED)].map((m) => m[1]))];
  if (names.length === 0) return;
  fail(
    file,
    where,
    `${field} expands ${names.join(', ')} into the shell text, so the value runs as commands. Pass it through the step's env: and read it as a quoted variable.`
  );
}

function checkStep(file, where, step, isBenchWorkflow, isDefinition = false) {
  checkPinned(file, where, step.uses);
  checkSpliced(file, where, 'run:', step.run);
  checkSpliced(file, where, 'script:', step.with?.script);
  const uses = action(step);
  const w = step.with ?? {};
  const allowed = NATIVE_BUILD_ALLOWED[file] ?? {};
  for (const build of isDefinition ? [] : nativeBuilds(step.run)) {
    if (build in allowed) continue;
    fail(
      file,
      where,
      `${build} runs outside the shared build definitions. Call ${BUILD_DEFINITIONS.join(' or ')} instead.`
    );
  }

  const first = FIRST_NODE24[uses];
  const version = first && refVersion(step.uses);
  if (version && before(version, versionOf(first))) {
    fail(
      file,
      where,
      `${step.uses} runs on Node 20, which the runner has deprecated. Pin ${uses}@v${first} or later.`
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
  if (uses === 'hendrikmuhs/ccache-action' && text(w['append-timestamp']) === 'false') {
    fail(
      file,
      where,
      'ccache-action with append-timestamp: false saves its key once and can never replace it, so the store stays the first one saved. Drop it and keep the prefix restore-keys.'
    );
  }
  if (launchesCcache(step.env) && text(step.env.CCACHE_COMPILERCHECK) !== 'content') {
    fail(
      file,
      where,
      "ccache checks the compiler by mtime by default, and a compiler installed fresh on each run then misses every compile. Set CCACHE_COMPILERCHECK: content in the step's env."
    );
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
  if (uses === 'actions/setup-node' && text(w['node-version-file']) !== NODE_VERSION_FILE) {
    fail(
      file,
      where,
      `actions/setup-node must read the Node major from the one pin. Set node-version-file: ${NODE_VERSION_FILE}.`
    );
  }
  if (Object.hasOwn(w, 'node-version')) {
    fail(
      file,
      where,
      `node-version names a Node major beside ${NODE_VERSION_FILE}. Drop it and read ${NODE_VERSION_FILE}.`
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
  checkGradleCache(file, where, step);
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
  checkPodStep(file, where, step);
}

/**
 * A step that installs or runs CocoaPods takes it from the pinned bundle. A
 * plain `gem install` takes the newest release whatever the lockfiles say, and
 * a swallowed failure leaves `pod` running at whatever version the image had.
 */
function checkPodStep(file, where, step) {
  const lines = text(step.run)
    .replace(/\\\r?\n/g, ' ')
    .split('\n');
  if (lines.some((line) => GEM_INSTALL_PODS.test(line))) {
    fail(
      file,
      where,
      `gem install cocoapods installs a version no lockfile names. Pin cocoapods in ${POD_GEMFILE} and run bundle exec pod.`
    );
  }
  const podLines = lines.filter((line) => POD_COMMAND.test(line));
  if (podLines.length === 0) return;
  if (podLines.some((line) => !/\bbundle\s+exec\s+pod\b/.test(line))) {
    fail(
      file,
      where,
      `pod runs outside the bundle, at whatever version the runner has. Run it as bundle exec pod.`
    );
  }
  if (podLines.some((line) => /\|\|\s*(true|:)(\s|;|$)/.test(line))) {
    fail(
      file,
      where,
      'a pod failure is swallowed by || true, so the step passes on a broken install.'
    );
  }
  if (!text(step.env?.BUNDLE_GEMFILE).endsWith(POD_GEMFILE)) {
    fail(
      file,
      where,
      `pod runs without BUNDLE_GEMFILE naming ${POD_GEMFILE} in the step env, so bundler looks for another Gemfile.`
    );
  }
  podsRun = true;
}

/**
 * The pod bundle pins one exact cocoapods version and its lockfile resolves
 * that version, so `bundle exec pod` runs the same release everywhere.
 */
function checkPodBundle(files) {
  const gemfile = files.get(POD_GEMFILE);
  const pin = gemfile?.match(
    /^\s*gem\s+["']cocoapods["']\s*,\s*["']\s*(?:=\s*)?(\d+(?:\.\d+)*)["']\s*$/m
  );
  if (!pin) {
    fail(
      POD_GEMFILE,
      '',
      'a workflow runs pod, and cocoapods has no exact version here. Add gem "cocoapods", "<version>".'
    );
    return;
  }
  const lockfile = `${POD_GEMFILE}.lock`;
  const locked = files.get(lockfile)?.match(/^ {4}cocoapods \(([^)]+)\)$/m)?.[1];
  if (locked !== pin[1]) {
    fail(
      lockfile,
      '',
      `cocoapods is pinned at ${pin[1]} and locked at ${locked ?? 'nothing'}. Run bundle lock in config/fastlane.`
    );
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
 * Gradle's build cache is off unless the call asks for it, so a call without
 * --build-cache reruns Kotlin, lint and R8 even when the restored caches hold
 * their outputs. Each command is judged on its own, continuation lines joined.
 */
function checkGradleCache(file, where, step) {
  const commands = text(step.run)
    .replace(/\\\r?\n/g, ' ')
    .split(/\n|&&|\|\||;|\|/);
  if (
    commands.some(
      (command) => /\bgradlew\b/.test(command) && !/(^|\s)--build-cache(\s|$)/.test(command)
    )
  ) {
    fail(
      file,
      where,
      'a gradlew call leaves the build cache off, so every task reruns. Pass --build-cache.'
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

const IDENTITY_CHECK = /\bbuild-record\.js\s+identity\b[^\n]*--variant\s+\S/;
const isIdentityCheck = (step) => IDENTITY_CHECK.test(text(step.run));
// A step whose condition requires failure() uploads logs, never an app.
const onFailureOnly = (step) =>
  /(^|[^!\w])failure\(\)/.test(text(step.if)) && !/\|\|/.test(text(step.if));

/**
 * In a build definition, each upload of an artifact (logs uploaded on failure
 * aside) follows a step that checks the artifact's identity against the
 * selected variant, and at least one such check carries no cache-hit
 * condition, so a restored artifact is judged as a built one is.
 */
function checkArtifactIdentity(file, id, steps) {
  if (!BUILD_DEFINITIONS.includes(file)) return;
  let checked = false;
  for (const [i, step] of steps.entries()) {
    if (isIdentityCheck(step)) checked = true;
    if (action(step) !== 'actions/upload-artifact' || onFailureOnly(step) || checked) continue;
    fail(
      file,
      `job ${id} step ${step.name ?? step.uses ?? i + 1}`,
      'the artifact is uploaded before any step runs node scripts/build-record.js identity <artifact> --variant <variant>, so one carrying the other identity leaves the job.'
    );
  }
  const uploads = steps.some((s) => action(s) === 'actions/upload-artifact' && !onFailureOnly(s));
  const everyPath = steps.some((s) => isIdentityCheck(s) && !/cache-hit/.test(text(s.if)));
  if (uploads && checked && !everyPath) {
    fail(
      file,
      `job ${id}`,
      'every identity check is skipped on a cache hit, so a restored artifact is uploaded unjudged. Run one on every path.'
    );
  }
}

const VARIANT_FROM_CALLER = /^\$\{\{\s*inputs\.variant\s*\}\}$/;
const SETS_VARIANT = /(^|[\s;&|(])APP_VARIANT=/m;

/**
 * In a build definition, the identity is the job's, never a step's: a value
 * set on one command is gone by the next one that evaluates the Expo
 * configuration, which then builds the Dev identity.
 */
function checkVariant(file, id, job, workflowEnv) {
  if (!BUILD_DEFINITIONS.includes(file)) return;
  const steps = job.steps ?? [];
  for (const [i, step] of steps.entries()) {
    const setsInEnv = step.env && Object.hasOwn(step.env, 'APP_VARIANT');
    if (!setsInEnv && !SETS_VARIANT.test(text(step.run))) continue;
    fail(
      file,
      `job ${id} step ${step.name ?? step.uses ?? i + 1}`,
      'sets APP_VARIANT, which holds for this step alone, so a later step that reads the Expo configuration builds another identity. Set it once in the job env from inputs.variant.'
    );
  }
  if (!steps.some((step) => nativeBuilds(step.run).length > 0)) return;
  const value = job.env?.APP_VARIANT ?? workflowEnv?.APP_VARIANT;
  if (VARIANT_FROM_CALLER.test(text(value).trim())) return;
  fail(
    file,
    `job ${id}`,
    value === undefined
      ? 'builds natively with no APP_VARIANT in the job or workflow env, so every step after prebuild reads the Dev identity. Set APP_VARIANT: ${{ inputs.variant }} on the job.'
      : `sets APP_VARIANT to ${text(value)}, not \${{ inputs.variant }}, so the caller's choice of identity is not the one built.`
  );
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

/** The pin exists, and package.json engines.node admits that major and no other. */
function checkNodePin(sources) {
  const pin = sources.get(NODE_VERSION_FILE)?.toString('utf8') ?? '';
  const major = /^\s*v?(\d+)/.exec(pin)?.[1];
  if (!major) {
    fail(
      NODE_VERSION_FILE,
      '',
      'is missing or names no Node major, and every setup-node reads it.'
    );
    return;
  }
  let range = '';
  try {
    range = text(JSON.parse(sources.get('package.json')?.toString('utf8') ?? '{}').engines?.node);
  } catch {
    // A package.json that does not parse fails every other gate first.
  }
  if (!new RegExp(`^\\s*[\\^~]?${major}(\\.|\\s*$)`).test(range) || /\|\||>|</.test(range)) {
    fail(
      'package.json',
      '',
      `engines.node must hold Node ${major} alone, the major ${NODE_VERSION_FILE} pins (for example ^${major}.0.0).`
    );
  }
}

/** Whether a workflow has a step running cargo audit with warnings denied. */
function scansAdvisories(workflow) {
  return Object.values(workflow?.jobs ?? {}).some((job) =>
    (job.steps ?? []).some((step) =>
      cargoCommands(step.run).some(
        ({ subcommand, rest }) =>
          subcommand === 'audit' && /(^|\s)(--deny|-D)\s+warnings(\s|$)/.test(rest)
      )
    )
  );
}

function checkAdvisoriesScanned(file, workflow, workflows) {
  if (file !== ADVISORY_SCANNED) return;
  const called = Object.values(workflow.jobs ?? {})
    .map((job) => text(job.uses).replace(/^\.\//, '').split('@')[0])
    .filter((target) => target.startsWith('.github/workflows/'));
  if (!scansAdvisories(workflow) && !called.some((t) => scansAdvisories(workflows.get(t)))) {
    fail(
      file,
      'jobs',
      'no job runs cargo audit --deny warnings over the Rust lockfile, so an advisory against a shipped crate is never reported. Ignore a warning in .cargo/audit.toml with its reason rather than letting warnings through.'
    );
  }
  const scheduled = [...workflows.values()].some(
    (other) => 'schedule' in triggersOf(other) && scansAdvisories(other)
  );
  if (!scheduled) {
    fail(
      file,
      'jobs',
      'no scheduled workflow runs cargo audit, so an advisory published against an unchanged lockfile waits for the next push.'
    );
  }
}

function stepsOf(file, steps, prefix, isBenchWorkflow, isDefinition = false) {
  (steps ?? []).forEach((step, i) => {
    checkRustProfile(file, `${prefix}step ${step.name ?? step.uses ?? i + 1}`, step.env, step.run);
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

/** A release workflow: a tag starts it, and no branch or pull request does. */
function startsOnTagOnly(triggers) {
  return (
    Boolean(triggers.push?.tags) &&
    !triggers.push.branches &&
    !('pull_request' in triggers) &&
    !('schedule' in triggers)
  );
}

/**
 * A tag release is read by its colour, so a deploy that skips itself for a
 * missing credential, or is never started for a missing artefact, ends green
 * with nothing uploaded.
 */
function checkTagDeploys(file, id, job) {
  if (/\bneeds\.[\w-]+\.outputs\./.test(text(job.if))) {
    fail(
      file,
      `job ${id}`,
      'runs only when an earlier job found its artefact, so a missing artefact skips the deploy and the run ends green. Fail the job that looks for it instead.'
    );
  }
  (job.steps ?? []).forEach((step, i) => {
    if (/\bskip\s*=\s*true\b/.test(text(step.run))) {
      fail(
        file,
        `job ${id} step ${step.name ?? step.uses ?? i + 1}`,
        'skips the deploy when something is missing, so the run ends green with nothing uploaded. Exit non-zero instead.'
      );
    }
  });
}

const FLOATING_RUNNER = /-latest$/;

/** The runner labels a job names, with each `matrix.KEY` expanded to its values. */
function runnerLabels(job) {
  const runsOn = job['runs-on'];
  const named = Array.isArray(runsOn)
    ? runsOn
    : runsOn && typeof runsOn === 'object'
      ? [runsOn.labels ?? []].flat()
      : [runsOn];
  return named.flatMap((label) => {
    const key = text(label).match(/^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/)?.[1];
    if (!key) return [text(label)];
    const matrix = job.strategy?.matrix ?? {};
    return [
      ...[matrix[key] ?? []].flat(),
      ...[matrix.include ?? []].flat().map((entry) => entry?.[key]),
    ].map(text);
  });
}

function checkRunner(file, id, job) {
  for (const label of runnerLabels(job)) {
    if (FLOATING_RUNNER.test(label)) {
      fail(
        file,
        `job ${id} runs-on`,
        `runs on ${label}, which moves to a new image on GitHub's date; name the image version.`
      );
    }
  }
}

const SHARD_FLAG = /--shard[=\s]+(\$\{\{[^}]*\}\}|[^\s/]+)\/(\d+)\b/g;

/** Every `--shard` in a job takes its index from a matrix key that lists each shard once. */
function checkShards(file, id, job) {
  const matrix = job.strategy?.matrix ?? {};
  for (const [index, step] of (job.steps ?? []).entries()) {
    const where = `job ${id} step ${step.name ?? index + 1}`;
    for (const [, part, count] of text(step.run).matchAll(SHARD_FLAG)) {
      const key = part.match(/^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/)?.[1];
      if (!key) {
        fail(
          file,
          where,
          `--shard=${part}/${count} runs one shard alone. Take the index from a matrix key.`
        );
        continue;
      }
      const values = [matrix[key] ?? []]
        .flat()
        .map(Number)
        .sort((a, b) => a - b);
      const total = Number(count);
      const whole = values.length === total && values.every((value, i) => value === i + 1);
      if (!whole) {
        fail(
          file,
          where,
          `--shard counts ${total} shards and matrix.${key} lists [${values.join(', ')}], so a shard goes unrun or runs twice. List 1 to ${total} once each.`
        );
      }
    }
  }
}

/** An `if:` that runs a job only on what an earlier job's outputs say. */
const GATED_ON = /\bneeds\.([\w-]+)\.outputs\./g;

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
      for (const [, gate] of text(jobs[other].if).matchAll(GATED_ON)) {
        if (!body.includes(`needs.${gate}.outputs.`)) {
          fail(
            file,
            `job ${id}`,
            `${other} runs only on needs.${gate}.outputs and the aggregator never reads them, so it cannot tell a skip the change allows from one it does not.`
          );
        }
      }
    }
  }
}

const sources = indexedSources(root, [
  '.github/workflows',
  '.github/actions',
  NODE_VERSION_FILE,
  'package.json',
]);
refuseEmptyListing(sources, 'Workflow guard');
checkNodePin(sources);

const parsed = new Map();
for (const [file, bytes] of sources) {
  const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
  const isAction = /^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(file);
  if (!isWorkflow && !isAction) continue;
  try {
    const source = bytes.toString('utf8');
    for (const [, pinned, tag] of source.matchAll(PIN_COMMENT)) PIN_TAGS.set(pinned, tag);
    const doc = load(source);
    if (doc && typeof doc === 'object') parsed.set(file, { doc, isAction });
  } catch (error) {
    fail(file, '', `does not parse: ${error.message.split('\n')[0]}`);
  }
}
const workflows = new Map(
  [...parsed].filter(([, { isAction }]) => !isAction).map(([file, { doc }]) => [file, doc])
);

for (const [file, { doc, isAction }] of parsed) {
  checkRustProfile(file, 'env', doc.env);
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
    checkRustProfile(file, `job ${id} env`, job.env);
    if (onMain) checkCancel(file, `job ${id} concurrency`, job.concurrency);
    stepsOf(file, job.steps, `job ${id} `, isBenchWorkflow, isDefinition);
    checkKeys(file, id, job.steps ?? []);
    checkRustSaves(file, id, job.steps ?? []);
    checkArtifactIdentity(file, id, job.steps ?? []);
    checkVariant(file, id, job, doc.env);
    checkCall(file, id, job, workflows);
    checkRunner(file, id, job);
    checkShards(file, id, job);
    checkPinned(file, `job ${id}`, job.uses);
    if (startsOnTagOnly(triggers)) checkTagDeploys(file, id, job);
  }
  checkSchedule(file, doc, triggers);
  checkAggregators(file, doc);
  checkBenchesChecked(file, doc);
  checkAdvisoriesScanned(file, doc, workflows);
}

if (podsRun) {
  const bundle = indexedSources(root, [POD_GEMFILE, `${POD_GEMFILE}.lock`]);
  checkPodBundle(new Map([...bundle].map(([file, bytes]) => [file, bytes.toString('utf8')])));
}

if (failures.length > 0) {
  console.error(
    `Workflow guard: ${failures.length} rule${failures.length === 1 ? '' : 's'} broken.\n`
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(
  'Workflow guard: caches write from main only, no schedule re-runs a sha, every job is reported, each platform builds in one place, every runner names its image, every third-party action is pinned to a commit.'
);

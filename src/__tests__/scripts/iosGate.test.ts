/**
 * Scenario: an iOS build is qualified on a remote Mac from a tree that is not
 * the branch it claims to be. Snapshot trees there carried synthetic commits,
 * so the stamp named a sha that is on no branch, and the app on the simulator
 * carried an empty `buildCommit`, so nobody could say what had been run.
 *
 * Expected behaviour: the gate pushes the sha, builds the gate tree only when
 * its stamp is that sha, refuses a simulator that is not booted, and refuses a
 * record whose installed `buildCommit` or flows do not hold up. A step that
 * fails is named.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const REPO = path.resolve(__dirname, '../../..');
const GATE = path.join(REPO, 'scripts/lib/ios-gate.js');

const {
  chooseSimulator,
  junitFlows,
  prune,
  recordProblems,
  stampProblem,
} = require('../../../scripts/lib/ios-gate.js');

const SHA = '4a1c9e0b7d2f3e8a6b5c4d3e2f1a0b9c8d7e6f5a';
const UDID = 'A864C468-0000-4000-8000-000000000001';
const OTHER = 'A864C468-0000-4000-8000-000000000002';

function simulators(...devices: { udid: string; state: string; name?: string }[]) {
  return {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-26-2': devices.map((d) => ({
        name: d.name ?? 'iPhone 17 Pro Max',
        isAvailable: true,
        ...d,
      })),
    },
  };
}

describe('the stamp of the gate tree', () => {
  it('passes when it is the pushed sha, at any abbreviation', () => {
    expect(stampProblem('4a1c9e0b7', SHA)).toBeNull();
    expect(stampProblem('4a1c9e0b7d2f', SHA)).toBeNull();
  });

  it('is refused when it names another commit', () => {
    expect(stampProblem('767ed98aa', SHA)).toMatch(/767ed98aa.*4a1c9e0b7d2f/);
  });

  it('is refused when the tree differs from the commit', () => {
    expect(stampProblem('4a1c9e0b7+3c9e04b1', SHA)).toMatch(/differs/);
  });

  it('is refused when it is empty or too short to name a commit', () => {
    expect(stampProblem('', SHA)).toMatch(/no stamp/);
    expect(stampProblem('4a1c', SHA)).not.toBeNull();
  });
});

describe('the simulator', () => {
  it('is the one booted when none is named', () => {
    const list = simulators({ udid: UDID, state: 'Booted' }, { udid: OTHER, state: 'Shutdown' });
    expect(chooseSimulator(list)).toEqual({ udid: UDID });
  });

  it('is refused when none is booted', () => {
    const list = simulators({ udid: UDID, state: 'Shutdown' });
    expect(chooseSimulator(list).problem).toMatch(/no simulator is booted/);
  });

  it('is refused when the one named is not booted', () => {
    const list = simulators({ udid: UDID, state: 'Shutdown' }, { udid: OTHER, state: 'Booted' });
    expect(chooseSimulator(list, UDID).problem).toMatch(new RegExp(`${UDID}.*Shutdown`));
  });

  it('is refused when the one named does not exist', () => {
    const list = simulators({ udid: OTHER, state: 'Booted' });
    expect(chooseSimulator(list, UDID).problem).toMatch(/no simulator/);
  });

  it('is refused when two are booted, since the install goes to whichever is booted', () => {
    const list = simulators({ udid: UDID, state: 'Booted' }, { udid: OTHER, state: 'Booted' });
    expect(chooseSimulator(list).problem).toMatch(/2 simulators are booted/);
    expect(chooseSimulator(list, UDID).problem).toMatch(/2 simulators are booted/);
  });
});

describe('the flows a JUnit report carries', () => {
  it('splits passed from failed, an error counting as failed', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites><testsuite name="Test Suite" tests="4" failures="2">',
      '<testcase id="smoke" name="smoke" classname="smoke" time="12.0"/>',
      '<testcase id="map-comprehensive" name="map-comprehensive" classname="map" time="40.1">',
      '<failure>Element not found: map-view</failure>',
      '</testcase>',
      '<testcase name="navigation-deep-links" time="20.0"></testcase>',
      '<testcase name="stress-map-toggles"><error>App crashed</error></testcase>',
      '</testsuite></testsuites>',
    ].join('\n');

    expect(junitFlows(xml)).toEqual({
      passed: ['smoke', 'navigation-deep-links'],
      failed: ['map-comprehensive', 'stress-map-toggles'],
    });
  });
});

describe('a gate record', () => {
  const green = {
    sha: SHA,
    installedBuildCommit: '4a1c9e0b7',
    flows: { passed: ['smoke', 'map-comprehensive'], failed: [] },
  };

  it('passes when the installed app is the sha and every flow passed', () => {
    expect(recordProblems(green, SHA)).toEqual([]);
  });

  it('is refused when the installed buildCommit differs from the sha', () => {
    const problems = recordProblems({ ...green, installedBuildCommit: '767ed98aa' }, SHA);
    expect(problems.join('\n')).toMatch(/installed.*767ed98aa/);
  });

  it('is refused when the installed app carries no buildCommit', () => {
    const problems = recordProblems({ ...green, installedBuildCommit: '' }, SHA);
    expect(problems.join('\n')).toMatch(/installed/);
  });

  it('is refused when the record is for another sha', () => {
    expect(recordProblems({ ...green, sha: '9'.repeat(40) }, SHA).join('\n')).toMatch(/record/);
  });

  it('is refused when a flow failed, naming it', () => {
    const record = { ...green, flows: { passed: ['smoke'], failed: ['map-comprehensive'] } };
    expect(recordProblems(record, SHA).join('\n')).toMatch(/map-comprehensive/);
  });

  it('is refused when no flow ran', () => {
    const record = { ...green, flows: { passed: [], failed: [] } };
    expect(recordProblems(record, SHA).join('\n')).toMatch(/no flow/);
  });

  it('is refused when a step failed, naming it', () => {
    const record = { ...green, failedStep: 'prebuild' };
    expect(recordProblems(record, SHA).join('\n')).toMatch(/prebuild/);
  });
});

/**
 * The Mac's disk fills with the screen recordings every UI test run leaves in
 * the simulator's test manager container, and with a DerivedData tree per
 * build. The prune step frees the old ones for the gate alone and touches
 * nothing that belongs to the simulator's apps or to another workspace.
 */
describe('the prune step', () => {
  const NOW = Date.parse('2026-06-15T12:00:00Z');
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  let home: string;
  let gateTree: string;

  function plist(entries: Record<string, string>, dates: Record<string, string> = {}) {
    const keys = [
      ...Object.entries(entries).map(([k, v]) => `<key>${k}</key>\n<string>${v}</string>`),
      ...Object.entries(dates).map(([k, v]) => `<key>${k}</key>\n<date>${v}</date>`),
    ];
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      '<dict>',
      ...keys,
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }

  function write(file: string, body: string | Buffer, ageMs?: number) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    if (ageMs !== undefined) {
      const at = new Date(NOW - ageMs);
      fs.utimesSync(file, at, at);
    }
    return file;
  }

  function container(kind: string, id: string, identifier: string) {
    const dir = path.join(
      home,
      'Library/Developer/CoreSimulator/Devices',
      UDID,
      'data/Containers/Data',
      kind,
      id
    );
    write(
      path.join(dir, '.com.apple.mobile_container_manager.metadata.plist'),
      plist({ MCMMetadataIdentifier: identifier })
    );
    return dir;
  }

  function derived(name: string, workspace: string, ageMs: number) {
    const dir = path.join(home, 'Library/Developer/Xcode/DerivedData', name);
    const accessed = new Date(NOW - ageMs).toISOString().replace(/\.\d+Z$/, 'Z');
    write(
      path.join(dir, 'info.plist'),
      plist({ WorkspacePath: workspace }, { LastAccessedDate: accessed })
    );
    write(path.join(dir, 'Build/Products/app.bin'), Buffer.alloc(1000));
    return dir;
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-gate-prune-'));
    gateTree = path.join(home, 'veloq-gate');
    fs.mkdirSync(gateTree);
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('frees old recordings and all but the two newest gate builds, and nothing else', () => {
    const daemon = container('InternalDaemon', 'C0FFEE01', 'com.apple.testmanagerd');
    const old = write(
      path.join(daemon, 'Attachments/run-a/screen.mov'),
      Buffer.alloc(5000),
      3 * DAY
    );
    const fresh = write(path.join(daemon, 'Attachments/run-b/screen.mov'), Buffer.alloc(700), HOUR);
    const app = container('Application', 'BEEF0001', 'com.veloq.app');
    const appFile = write(path.join(app, 'Documents/routes.db'), Buffer.alloc(300), 30 * DAY);
    const otherDaemon = container('InternalDaemon', 'C0FFEE02', 'com.apple.other');
    const otherFile = write(
      path.join(otherDaemon, 'Attachments/keep.mov'),
      Buffer.alloc(100),
      30 * DAY
    );

    const workspace = path.join(gateTree, 'ios/VeloqDev.xcworkspace');
    const oldest = derived('VeloqDev-aaaa', workspace, 9 * DAY);
    const middle = derived('Veloq-bbbb', workspace, 5 * DAY);
    const newest = derived('VeloqDev-cccc', workspace, DAY);
    const elsewhere = derived(
      'VeloqDev-dddd',
      '/Users/someone/veloq/ios/VeloqDev.xcworkspace',
      40 * DAY
    );
    // A sibling tree whose path starts with the gate's is another workspace.
    const sibling = derived('VeloqDev-eeee', `${gateTree}-old/ios/VeloqDev.xcworkspace`, 40 * DAY);

    const freed = prune({ home, simulator: UDID, gate: gateTree, now: NOW });

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(appFile)).toBe(true);
    expect(fs.existsSync(otherFile)).toBe(true);
    expect(fs.existsSync(oldest)).toBe(false);
    for (const kept of [middle, newest, elsewhere, sibling]) expect(fs.existsSync(kept)).toBe(true);
    expect(fs.existsSync(path.join(gateTree, '.metadata_never_index'))).toBe(true);

    expect(freed.attachments).toEqual({ files: 1, bytes: 5000 });
    expect(freed.derivedData.removed).toEqual([oldest]);
    expect(freed.derivedData.bytes).toBeGreaterThanOrEqual(1000);
    expect(freed.bytes).toBe(freed.attachments.bytes + freed.derivedData.bytes);
  });

  it('frees nothing on a second run', () => {
    const daemon = container('InternalDaemon', 'C0FFEE01', 'com.apple.testmanagerd');
    write(path.join(daemon, 'Attachments/screen.mov'), Buffer.alloc(5000), 3 * DAY);
    const workspace = path.join(gateTree, 'ios/VeloqDev.xcworkspace');
    for (const [name, age] of [
      ['VeloqDev-aaaa', 9 * DAY],
      ['VeloqDev-bbbb', 5 * DAY],
      ['VeloqDev-cccc', DAY],
    ] as const) {
      derived(name, workspace, age);
    }

    expect(prune({ home, simulator: UDID, gate: gateTree, now: NOW }).bytes).toBeGreaterThan(0);
    expect(prune({ home, simulator: UDID, gate: gateTree, now: NOW }).bytes).toBe(0);
  });

  it('frees nothing when the simulator has no test manager container or DerivedData', () => {
    container('Application', 'BEEF0001', 'com.veloq.app');

    const freed = prune({ home, simulator: UDID, gate: gateTree, now: NOW });

    expect(freed.bytes).toBe(0);
    expect(fs.existsSync(path.join(gateTree, '.metadata_never_index'))).toBe(true);
  });
});

describe('the verify command', () => {
  it('exits non-zero on a record whose installed buildCommit differs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-gate-verify-'));
    const file = path.join(dir, 'record.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        sha: SHA,
        installedBuildCommit: '767ed98aa',
        flows: { passed: ['smoke'], failed: [] },
      })
    );
    const run = spawnSync('node', [GATE, 'verify', '--sha', SHA, file], {
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/767ed98aa/);
  });
});

/**
 * The whole run from the local checkout, with `ssh` and `scp` replaced by
 * stand-ins that run the remote half on this machine against a second
 * repository, the one the gate remote's URL names. `xcrun`, `npm`, `npx` and
 * `maestro` are stand-ins too, steered by files in `fake/`, and the gate tree's
 * own build and install scripts are the fixture's.
 */
type Fixture = { root: string; local: string; remote: string; fake: string; home: string };

const FIXTURE_SCRIPTS: Record<string, string> = {
  'scripts/run-ios.sh': [
    '#!/bin/sh',
    'echo "run-ios $*" >> "$GATE_FAKE/calls.log"',
    '[ ! -e "$GATE_FAKE/fail-build" ] || { echo "error: no such module ExpoModulesCore" >&2; exit 65; }',
    '',
  ].join('\n'),
  'scripts/install-ios.sh': [
    '#!/bin/sh',
    'echo "install-ios $*" >> "$GATE_FAKE/calls.log"',
    'commit=$(node -e "process.stdout.write(require(\'./scripts/lib/build-stamp.js\').buildStamp())")',
    '[ ! -e "$GATE_FAKE/installed-commit" ] || commit=$(cat "$GATE_FAKE/installed-commit")',
    'mkdir -p "$GATE_FAKE/app/EXConstants.bundle"',
    'printf \'{"extra":{"buildCommit":"%s"}}\' "$commit" > "$GATE_FAKE/app/EXConstants.bundle/app.config"',
    '',
  ].join('\n'),
  'scripts/lib/app-identity.js': "console.log('com.veloq.app.dev');\n",
  '.maestro/smoke.yaml': 'appId: com.veloq.app.dev\n',
};

const FAKES: Record<string, string> = {
  ssh: [
    '#!/bin/sh',
    // Options git and the gate pass, then the host, then the command.
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '  -G) exit 0 ;;',
    '  -o | -p) shift 2 ;;',
    '  -*) shift ;;',
    '  *) break ;;',
    '  esac',
    'done',
    'echo "ssh $*" >> "$GATE_FAKE/calls.log"',
    'shift',
    'exec sh -c "$*"',
    '',
  ].join('\n'),
  scp: [
    '#!/bin/sh',
    'echo "scp $*" >> "$GATE_FAKE/calls.log"',
    'set --  $(for a in "$@"; do case "$a" in -*) ;; *) printf "%s\\n" "${a#*:}" ;; esac; done)',
    'exec cp "$@"',
    '',
  ].join('\n'),
  xcrun: [
    '#!/bin/sh',
    'echo "xcrun $*" >> "$GATE_FAKE/calls.log"',
    'case "$1 $2" in',
    '"simctl list") cat "$GATE_FAKE/simulators.json" ;;',
    '"simctl get_app_container") echo "$GATE_FAKE/app" ;;',
    'esac',
    '',
  ].join('\n'),
  xcodebuild: '#!/bin/sh\nprintf "Xcode 26.2\\nBuild version 17C52\\n"\n',
  pod: '#!/bin/sh\necho 1.16.2\n',
  rustc: '#!/bin/sh\necho "rustc 1.95.0 (fixture)"\n',
  sw_vers: '#!/bin/sh\necho 26.3.1\n',
  npm: [
    '#!/bin/sh',
    'echo "npm $*" >> "$GATE_FAKE/calls.log"',
    '[ ! -e "$GATE_FAKE/fail-npm" ] || exit 1',
    '',
  ].join('\n'),
  // Prebuild runs `pod install`, and CocoaPods stops on a Ruby encoding error
  // unless the locale is UTF-8, which a non-interactive ssh session does not set.
  npx: [
    '#!/bin/sh',
    'echo "npx $*" >> "$GATE_FAKE/calls.log"',
    'case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in',
    '*UTF-8* | *utf8*) ;;',
    '*)',
    '  echo "invalid byte sequence in US-ASCII (Encoding::CompatibilityError)" >&2',
    '  exit 1',
    '  ;;',
    'esac',
    'if [ -e "$GATE_FAKE/fail-prebuild" ]; then',
    '  echo "[!] Unable to find a specification for ExpoModulesCore" >&2',
    '  exit 1',
    'fi',
    '[ ! -e "$GATE_FAKE/dirty-prebuild" ] || echo changed >> app.json',
    '',
  ].join('\n'),
  maestro: [
    '#!/bin/sh',
    'echo "maestro $*" >> "$GATE_FAKE/calls.log"',
    'out=""',
    'flow=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '  --output) out=$2; shift ;;',
    '  *.yaml) flow=$(basename "$1" .yaml) ;;',
    '  esac',
    '  shift',
    'done',
    'name=${flow:-smoke}',
    'if [ -e "$GATE_FAKE/fail-flow" ]; then',
    '  printf \'<testsuites><testsuite><testcase name="%s"><failure>gone</failure></testcase></testsuite></testsuites>\' "$name" > "$out"',
    '  exit 1',
    'fi',
    'printf \'<testsuites><testsuite><testcase name="%s"/></testsuite></testsuites>\' "$name" > "$out"',
    '',
  ].join('\n'),
};

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-gate-'));
  const local = path.join(root, 'local');
  const remote = path.join(root, 'remote', 'veloq');
  const fake = path.join(root, 'fake');
  const bin = path.join(fake, 'bin');
  const home = path.join(root, 'home');
  for (const dir of [local, remote, bin, home]) fs.mkdirSync(dir, { recursive: true });

  for (const [file, body] of Object.entries(FIXTURE_SCRIPTS)) {
    const full = path.join(local, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(local, 'app.json'), '{}\n');
  // The scripts under test run from the fixture, as they run from a checkout,
  // and the stamp is the real one.
  for (const file of [
    'ios-gate.sh',
    'ios-gate-remote.sh',
    'with-simulator-lock.sh',
    'compute-source-hash.js',
    'lib/build-stamp.js',
  ]) {
    fs.copyFileSync(path.join(REPO, 'scripts', file), path.join(local, 'scripts', file));
    fs.chmodSync(path.join(local, 'scripts', file), 0o755);
  }
  fs.copyFileSync(GATE, path.join(local, 'scripts/lib/ios-gate.js'));
  runGit(['init', '-q', '-b', 'main'], local);
  runGit(['add', '-A'], local);
  runGit(['commit', '-q', '-m', 'base'], local);
  runGit(['init', '-q', '-b', 'trunk'], remote);
  runGit(['remote', 'add', 'gate', `ssh://fakehost${remote}`], local);
  runGit(['config', 'veloq.iosGateRemote', 'gate'], local);

  for (const [name, body] of Object.entries(FAKES)) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
  fs.writeFileSync(
    path.join(fake, 'simulators.json'),
    JSON.stringify(simulators({ udid: UDID, state: 'Booted' }))
  );
  return { root, local, remote, fake, home };
}

function gate(f: Fixture, branch = 'main') {
  // A non-interactive ssh session on the Mac carries no locale.
  const noLocale = { ...process.env };
  for (const name of ['LANG', 'LC_ALL', 'LC_CTYPE']) delete noLocale[name];
  // The session's own switches, the simulator lock among them, go with the git pointers.
  const run = spawnSync(path.join(f.local, 'scripts/ios-gate.sh'), [branch], {
    cwd: f.local,
    env: {
      ...gitFreeEnv(noLocale),
      PATH: `${path.join(f.fake, 'bin')}:${process.env.PATH}`,
      HOME: f.home,
      GATE_FAKE: f.fake,
    },
    encoding: 'utf8',
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

function head(f: Fixture): string {
  return runGit(['rev-parse', 'HEAD'], f.local).trim();
}

function record(f: Fixture) {
  const file = path.join(f.local, '.ios-gate', `${head(f)}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('scripts/ios-gate.sh', () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
  });
  afterEach(() => {
    fs.rmSync(f.root, { recursive: true, force: true });
  });

  it('pushes the sha, builds, installs, runs the flows and brings back a green record', () => {
    const run = gate(f);

    expect(run.out).toContain('ios-gate: passed');
    expect(run.status).toBe(0);
    expect(runGit(['rev-parse', 'refs/heads/gate/main'], f.remote).trim()).toBe(head(f));
    const r = record(f);
    expect(r.sha).toBe(head(f));
    expect(head(f).startsWith(r.installedBuildCommit)).toBe(true);
    expect(r.treeStamp).toBe(r.installedBuildCommit);
    expect(r.simulator).toBe(UDID);
    expect(r.flows.failed).toEqual([]);
    expect(r.flows.passed).toEqual(expect.arrayContaining(['smoke', 'recording-start-stop']));
    expect(r.tools).toMatchObject({ xcode: expect.stringContaining('26.2'), cocoapods: '1.16.2' });
    expect(r.pruned).toMatchObject({ bytes: 0 });
    expect(fs.existsSync(`${f.remote}-gate/.metadata_never_index`)).toBe(true);

    const calls = fs.readFileSync(path.join(f.fake, 'calls.log'), 'utf8');
    expect(calls).toMatch(/npx expo prebuild --platform ios --clean/);
    expect(calls).toMatch(/run-ios dev standalone/);
    expect(calls).toMatch(/install-ios Release --identity dev/);
    expect(calls).toMatch(
      new RegExp(`maestro --device ${UDID} test .*--include-tags=tier0,pack-map,pack-nav`)
    );
    // The lock is taken for the run and given back after it.
    expect(fs.readdirSync(path.join(f.home, '.veloq-locks'))).toEqual([]);
  });

  it('is refused when the gate tree is not the pushed sha after prebuild', () => {
    fs.writeFileSync(path.join(f.fake, 'dirty-prebuild'), '');

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/step stamp failed/);
    expect(run.out).toMatch(/differs/);
    expect(fs.readFileSync(path.join(f.fake, 'calls.log'), 'utf8')).not.toMatch(/run-ios/);
  });

  it('is refused when the installed app carries another buildCommit', () => {
    fs.writeFileSync(path.join(f.fake, 'installed-commit'), '767ed98');

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/installed.*767ed98/);
  });

  it('is refused before anything is built when the simulator is not booted', () => {
    fs.writeFileSync(
      path.join(f.fake, 'simulators.json'),
      JSON.stringify(simulators({ udid: UDID, state: 'Shutdown' }))
    );

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/no simulator is booted/);
    expect(fs.readFileSync(path.join(f.fake, 'calls.log'), 'utf8')).not.toMatch(/npm ci|run-ios/);
  });

  it('names the step when a Pod is missing', () => {
    fs.writeFileSync(path.join(f.fake, 'fail-prebuild'), '');

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/step prebuild failed/);
    expect(run.out).toMatch(/ExpoModulesCore/);
    expect(record(f).failedStep).toBe('prebuild');
  });

  it('fails when a flow fails, naming it, and still brings the record back', () => {
    fs.writeFileSync(path.join(f.fake, 'fail-flow'), '');

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/recording-start-stop/);
    expect(record(f).flows.failed.length).toBeGreaterThan(0);
  });

  it('runs again on the same gate tree for a later commit', () => {
    expect(gate(f).status).toBe(0);
    fs.writeFileSync(path.join(f.local, 'app.json'), '{"later":true}\n');
    runGit(['commit', '-q', '-am', 'later'], f.local);

    const run = gate(f);

    expect(run.status).toBe(0);
    expect(record(f).sha).toBe(head(f));
  });

  it('refuses when the simulator lock is held, naming the holder', () => {
    const lock = path.join(f.home, '.veloq-locks', `sim-${UDID}`);
    fs.mkdirSync(lock, { recursive: true });
    // The lock ages a holder by the shell's clock, which Jest's fake timers do not reach.
    const since = spawnSync('date', ['+%s'], { encoding: 'utf8', env: gitFreeEnv() }).stdout.trim();
    fs.writeFileSync(
      path.join(lock, 'holder'),
      `host=elsewhere pid=4242 item=another since=${since}\n`
    );

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/pid=4242/);
  });

  it('refuses without a gate remote configured', () => {
    runGit(['config', '--unset', 'veloq.iosGateRemote'], f.local);

    const run = gate(f);

    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/veloq.iosGateRemote/);
  });
});

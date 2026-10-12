// What the iOS gate decides, in one place for both of its halves.
//
// `scripts/ios-gate.sh` runs on the Linux checkout and `scripts/ios-gate-remote.sh`
// on the Mac, and this file is copied beside the remote half for each run, so it
// reads nothing from the tree it judges and requires nothing outside Node.
//
//   node ios-gate.js simulator [--udid UDID]     < `xcrun simctl list devices -j`
//   node ios-gate.js stamp --sha SHA --stamp STAMP
//   node ios-gate.js prune --simulator UDID --gate DIR --out FILE
//   node ios-gate.js record --out FILE --sha SHA --branch NAME [--simulator UDID]
//       [--stamp STAMP] [--installed APP_CONFIG] [--junit FILE]... [--failed-step NAME]
//       [--pruned FILE]
//   node ios-gate.js verify --sha SHA FILE

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// `git rev-parse --short` never gives fewer, and a host with more objects gives more.
const SHORTEST_SHA = 7;

// The simulator's test manager keeps a screen recording of every UI test run.
const TEST_MANAGER = 'com.apple.testmanagerd';
const RECORDING_MAX_AGE_MS = 2 * 24 * 3600 * 1000;
const GATE_BUILDS_KEPT = 2;
const DERIVED_DATA_NAME = /^(VeloqDev|Veloq)-/;

/**
 * Why a build stamp is not the commit the gate pushed, or null when it is. The
 * two hosts abbreviate a sha to different lengths, so the stamp only has to
 * start the full sha. A dirty tree's stamp carries a `+`.
 */
function stampProblem(stamp, sha) {
  if (!stamp) return 'the tree has no stamp, so the app would name no commit';
  if (stamp.includes('+')) return `the tree differs from ${sha}: its stamp is ${stamp}`;
  if (stamp.length < SHORTEST_SHA || !/^[0-9a-f]+$/.test(stamp) || !sha.startsWith(stamp)) {
    return `the stamp ${stamp} is not the pushed sha ${sha}`;
  }
  return null;
}

/**
 * The simulator to run on, from `simctl list devices -j`: the one named, or the
 * one booted. `install-ios.sh` installs to whichever simulator is booted, so a
 * second one booted is refused rather than guessed between.
 */
function chooseSimulator(list, udid) {
  const devices = Object.values(list?.devices ?? {}).flat();
  const booted = devices.filter((d) => d.state === 'Booted');
  const describe = (d) => `${d.name} ${d.udid}`;
  if (booted.length > 1) {
    return {
      problem: `${booted.length} simulators are booted (${booted.map(describe).join(', ')}); shut all but one down`,
    };
  }
  if (udid) {
    const named = devices.find((d) => d.udid === udid);
    if (!named) return { problem: `there is no simulator ${udid}` };
    if (named.state !== 'Booted') {
      return { problem: `simulator ${describe(named)} is ${named.state}; boot it first` };
    }
    return { udid };
  }
  if (booted.length === 0) {
    return {
      problem: 'no simulator is booted; boot one, or name one with VELOQ_IOS_GATE_SIMULATOR',
    };
  }
  return { udid: booted[0].udid };
}

function attribute(attrs, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
}

/** The flows a Maestro JUnit report passed and failed, an error counting as a failure. */
function junitFlows(xml) {
  const passed = [];
  const failed = [];
  const testcase = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const [, attrs, body = ''] of xml.matchAll(testcase)) {
    const name = attribute(attrs, 'name') ?? attribute(attrs, 'id') ?? '(unnamed)';
    if (/<(failure|error)\b/.test(body)) failed.push(name);
    else if (!/<skipped\b/.test(body)) passed.push(name);
  }
  return { passed, failed };
}

/** Every reason a gate record does not qualify the sha, empty when it does. */
function recordProblems(record, sha) {
  const problems = [];
  if (record.failedStep) problems.push(`step ${record.failedStep} failed`);
  if (record.sha !== sha) problems.push(`the record is for ${record.sha}, not ${sha}`);
  if (!record.failedStep) {
    const installed = stampProblem(record.installedBuildCommit, sha);
    if (installed) {
      problems.push(
        `the installed app carries buildCommit "${record.installedBuildCommit ?? ''}": ${installed}`
      );
    }
    const flows = record.flows ?? { passed: [], failed: [] };
    if (flows.failed.length > 0) problems.push(`flows failed: ${flows.failed.join(', ')}`);
    if (flows.passed.length + flows.failed.length === 0) problems.push('no flow ran');
  }
  return problems;
}

/**
 * One string or date value from a property list, or null. A binary plist is
 * converted to XML with `plutil` first, which exists on every Mac.
 */
function plistValue(file, key) {
  let text;
  try {
    const raw = fs.readFileSync(file);
    text =
      raw.subarray(0, 6).toString('latin1') === 'bplist'
        ? execFileSync('plutil', ['-convert', 'xml1', '-o', '-', file], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          })
        : raw.toString('utf8');
  } catch {
    return null;
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<key>${escaped}</key>\\s*<(string|date)>([^<]*)</\\1>`).exec(text);
  if (!match) return null;
  return match[2]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function children(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function treeBytes(dir) {
  let bytes = 0;
  for (const entry of children(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += treeBytes(full);
    else if (entry.isFile()) bytes += fs.lstatSync(full).size;
  }
  return bytes;
}

/** Deletes the files under `dir` last modified before `cutoff`, and the directories they empty. */
function removeOlderThan(dir, cutoff, freed) {
  for (const entry of children(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeOlderThan(full, cutoff, freed);
      if (children(full).length === 0) fs.rmdirSync(full);
    } else {
      const stat = fs.lstatSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(full, { force: true });
        freed.files += 1;
        freed.bytes += stat.size;
      }
    }
  }
}

/**
 * The simulator's test manager containers, found by the identifier the
 * container manager writes into each one, since the directory names are ids
 * the simulator chose.
 */
function testManagerContainers(home, udid) {
  const data = path.join(
    home,
    'Library/Developer/CoreSimulator/Devices',
    udid,
    'data/Containers/Data'
  );
  const found = [];
  for (const kind of children(data).filter((e) => e.isDirectory())) {
    for (const entry of children(path.join(data, kind.name)).filter((e) => e.isDirectory())) {
      const dir = path.join(data, kind.name, entry.name);
      const metadata = path.join(dir, '.com.apple.mobile_container_manager.metadata.plist');
      if (plistValue(metadata, 'MCMMetadataIdentifier') === TEST_MANAGER) found.push(dir);
    }
  }
  return found;
}

function isWithin(file, dir) {
  const relative = path.relative(dir, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Frees the disk the gate's runs leave behind on the Mac: the test manager's
 * recordings older than two days on the gate simulator, and every DerivedData
 * tree built from the gate tree but the two most recently used. Trees built
 * from any other workspace, and the simulator's app containers, are left
 * alone. The simulator itself is never erased: it carries the installed build
 * an upgrade is tested from. Spotlight is kept out of the gate tree.
 */
function prune({ home = os.homedir(), simulator, gate, now = Date.now() }) {
  const attachments = { files: 0, bytes: 0 };
  for (const dir of testManagerContainers(home, simulator)) {
    removeOlderThan(path.join(dir, 'Attachments'), now - RECORDING_MAX_AGE_MS, attachments);
  }

  const root = path.join(home, 'Library/Developer/Xcode/DerivedData');
  const builds = [];
  for (const entry of children(root)) {
    if (!entry.isDirectory() || !DERIVED_DATA_NAME.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const workspace = plistValue(path.join(dir, 'info.plist'), 'WorkspacePath');
    if (!workspace || !isWithin(workspace, gate)) continue;
    const accessed = Date.parse(plistValue(path.join(dir, 'info.plist'), 'LastAccessedDate') ?? '');
    builds.push({ dir, at: Number.isNaN(accessed) ? fs.statSync(dir).mtimeMs : accessed });
  }
  builds.sort((a, b) => b.at - a.at);
  const derivedData = { removed: [], bytes: 0 };
  for (const { dir } of builds.slice(GATE_BUILDS_KEPT)) {
    derivedData.bytes += treeBytes(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    derivedData.removed.push(dir);
  }

  fs.writeFileSync(path.join(gate, '.metadata_never_index'), '');
  return { attachments, derivedData, bytes: attachments.bytes + derivedData.bytes };
}

function version(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .join(' ');
  } catch {
    return null;
  }
}

/** The versions a native build depends on, read on the host that built it. */
function toolVersions() {
  return {
    macos: version('sw_vers', ['-productVersion']),
    xcode: version('xcodebuild', ['-version']),
    cocoapods: version('pod', ['--version']),
    node: process.version,
    rustc: version('rustc', ['--version']),
  };
}

function installedBuildCommit(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.extra?.buildCommit ?? '';
  } catch {
    return '';
  }
}

function buildRecord(options) {
  const flows = { passed: [], failed: [] };
  for (const file of options.junit) {
    if (!fs.existsSync(file)) continue;
    const found = junitFlows(fs.readFileSync(file, 'utf8'));
    flows.passed.push(...found.passed);
    flows.failed.push(...found.failed);
  }
  const record = {
    sha: options.sha,
    branch: options.branch,
    simulator: options.simulator ?? null,
    treeStamp: options.stamp ?? null,
    installedBuildCommit: options.installed ? installedBuildCommit(options.installed) : null,
    tools: toolVersions(),
    flows,
    finishedAt: new Date().toISOString(),
  };
  if (options.pruned) {
    try {
      record.pruned = JSON.parse(fs.readFileSync(options.pruned, 'utf8'));
    } catch {
      record.pruned = null;
    }
  }
  if (options.failedStep) record.failedStep = options.failedStep;
  return record;
}

function parse(argv) {
  const options = { junit: [], files: [] };
  const names = {
    '--sha': 'sha',
    '--stamp': 'stamp',
    '--udid': 'udid',
    '--out': 'out',
    '--branch': 'branch',
    '--simulator': 'simulator',
    '--installed': 'installed',
    '--failed-step': 'failedStep',
    '--gate': 'gate',
    '--pruned': 'pruned',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--junit') options.junit.push(argv[++i]);
    else if (names[arg]) options[names[arg]] = argv[++i] ?? '';
    else options.files.push(arg);
  }
  return options;
}

function refuse(message) {
  console.error(`ios-gate: ${message}`);
  process.exit(1);
}

function main(argv) {
  const [command, ...rest] = argv;
  const options = parse(rest);
  if (command === 'simulator') {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch {
      refuse('could not read the simulator list from simctl');
    }
    const chosen = chooseSimulator(list, options.udid);
    if (chosen.problem) refuse(chosen.problem);
    console.log(chosen.udid);
    return;
  }
  if (command === 'stamp') {
    const problem = stampProblem(options.stamp ?? '', options.sha ?? '');
    if (problem) refuse(problem);
    return;
  }
  if (command === 'prune') {
    if (!options.simulator || !options.gate || !options.out) {
      refuse('prune needs --simulator, --gate and --out');
    }
    const freed = prune({ simulator: options.simulator, gate: options.gate });
    fs.writeFileSync(options.out, `${JSON.stringify(freed, null, 2)}\n`);
    console.log(
      `ios-gate: freed ${freed.bytes} bytes, ${freed.attachments.files} recordings and ${freed.derivedData.removed.length} DerivedData trees`
    );
    return;
  }
  if (command === 'record') {
    const record = buildRecord(options);
    fs.writeFileSync(options.out, `${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    const [file] = options.files;
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      refuse(`no record could be read at ${file}`);
    }
    const problems = recordProblems(record, options.sha ?? '');
    if (problems.length > 0) refuse(problems.join('\nios-gate: '));
    const { passed } = record.flows;
    console.log(
      `ios-gate: passed, ${record.installedBuildCommit} installed on ${record.simulator}, ${passed.length} flows: ${passed.join(', ')}`
    );
    return;
  }
  console.error('usage: ios-gate.js simulator|stamp|prune|record|verify [options]');
  process.exit(2);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { chooseSimulator, junitFlows, prune, recordProblems, stampProblem };

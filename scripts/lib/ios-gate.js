// What the iOS gate decides, in one place for both of its halves.
//
// `scripts/ios-gate.sh` runs on the Linux checkout and `scripts/ios-gate-remote.sh`
// on the Mac, and this file is copied beside the remote half for each run, so it
// reads nothing from the tree it judges and requires nothing outside Node.
//
//   node ios-gate.js simulator [--udid UDID]     < `xcrun simctl list devices -j`
//   node ios-gate.js stamp --sha SHA --stamp STAMP
//   node ios-gate.js record --out FILE --sha SHA --branch NAME [--simulator UDID]
//       [--stamp STAMP] [--installed APP_CONFIG] [--junit FILE]... [--failed-step NAME]
//   node ios-gate.js verify --sha SHA FILE

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// `git rev-parse --short` never gives fewer, and a host with more objects gives more.
const SHORTEST_SHA = 7;

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
  console.error('usage: ios-gate.js simulator|stamp|record|verify [options]');
  process.exit(2);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { chooseSimulator, junitFlows, recordProblems, stampProblem };

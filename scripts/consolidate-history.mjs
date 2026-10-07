#!/usr/bin/env node
// Rebuild a branch that holds the history between a base tag and a source tip
// as at most a fixed number of commits, one per run of first-parent commits.
//
// A history consolidated once by hand goes stale within days of landings and
// cannot be topped up, because the source it was cut from is replaced under it.
// So the slicing is a script, and its state is a run map the next run reads:
// every run already published keeps its commit, and only the merges since are
// sliced into new runs. The branch tracks the tip for the cost of those runs.
//
// The walk follows first parents from the tip back to the base, switching to
// the second parent at each merge named with --unwrap, so a long-lived branch
// merged in one commit slices like the rest. Steps are grouped by the day of
// their commit and the area of the tree they change most, or by the label a
// groups file records for them, and adjacent runs are joined smallest first
// until the count fits.
//
// Each run becomes one commit: the tree of its last step, the previous run's
// commit as its only parent, the author and committer dates of its last step,
// and a signature when commit.gpgsign is set. A run never ends on a step whose
// dates are earlier than the previous run's end, or on one whose submodule
// pointer names a commit a fresh clone cannot fetch; it ends on the next step
// that qualifies instead.
//
// Nothing moves unless every check passes: the commit count, a tree equal to
// the tip, dates that never go backwards, every submodule pointer reachable,
// and the private-data guard over the whole range. Only refs/heads/<branch> is
// ever written; no remote and no checked-out branch is touched.
//
// Usage:
//   consolidate-history.mjs --base REV --tip REV --run-map FILE [options]
//
//   --branch NAME         the branch to write, consolidation by default
//   --run-map FILE        the runs of the last build, read when present and
//                         written after a build that passed; one line per run:
//                         end step, commit, label and message, tab separated.
//                         A message edited here is used by the next build.
//   --commit-map FILE     written after a build that passed: every commit of
//                         base..tip against the commit whose run holds it
//   --unwrap REV          a first-parent merge whose second parent is walked
//                         instead of its first; repeatable
//   --groups FILE         lines of `<step sha or prefix> <label>`, a label that
//                         takes the place of the step's area
//   --max N               the most commits the branch may hold, 99 by default
//   --reserve N           runs a fresh build leaves free for later merges, 9 by
//                         default
//   --orphans FILE        pointers accepted although no ref reaches them, the
//                         first column of each line
//   --orphans-until DATE  accept those only on commits dated at or before DATE
//   --fresh               ignore the run map and slice everything again
//   --dry-run             build and check, then leave the branch where it is

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVATE_DATA_GUARD = join(HERE, 'check-no-private-data.sh');
const GITLINK_MODE = '160000';

// A hook exports these and they beat the working directory, so a run started
// from one would read the hook's repository rather than the one asked for.
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  return env;
})();

function git(args, { input, env, gitDir } = {}) {
  const full = ['-c', 'core.quotePath=off', ...(gitDir ? ['--git-dir', gitDir] : []), ...args];
  return execFileSync('git', full, {
    encoding: 'utf8',
    env: { ...GIT_ENV, ...env },
    input,
    maxBuffer: 1 << 30,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitOk(args, options = {}) {
  try {
    git(args, options);
    return true;
  } catch {
    return false;
  }
}

function lines(text) {
  return text.split('\n').filter((line) => line !== '');
}

function fail(message) {
  console.error(`consolidate-history: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    branch: 'consolidation',
    max: 99,
    reserve: 9,
    unwrap: [],
    fresh: false,
    dryRun: false,
  };
  const value = (index) => {
    if (index + 1 >= argv.length) fail(`${argv[index]} needs a value`);
    return argv[index + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--base':
        options.base = value(i++);
        break;
      case '--tip':
        options.tip = value(i++);
        break;
      case '--branch':
        options.branch = value(i++);
        break;
      case '--run-map':
        options.runMap = resolve(value(i++));
        break;
      case '--commit-map':
        options.commitMap = resolve(value(i++));
        break;
      case '--unwrap':
        options.unwrap.push(value(i++));
        break;
      case '--groups':
        options.groups = resolve(value(i++));
        break;
      case '--max':
        options.max = Number(value(i++));
        break;
      case '--reserve':
        options.reserve = Number(value(i++));
        break;
      case '--orphans':
        options.orphans = resolve(value(i++));
        break;
      case '--orphans-until':
        options.orphansUntil = value(i++);
        break;
      case '--fresh':
        options.fresh = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        fail(`unknown argument ${arg}`);
    }
  }
  if (!options.base || !options.tip || !options.runMap) {
    fail('--base, --tip and --run-map are required');
  }
  if (!Number.isInteger(options.max) || options.max < 1) fail('--max takes a positive integer');
  if (!Number.isInteger(options.reserve) || options.reserve < 0 || options.reserve >= options.max) {
    fail('--reserve takes an integer from 0 to one less than --max');
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

const resolveCommit = (rev) => {
  try {
    return git(['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`]).trim();
  } catch {
    return fail(`${rev} is not a commit`);
  }
};

const base = resolveCommit(options.base);
const tip = resolveCommit(options.tip);
const unwrap = new Set(options.unwrap.map(resolveCommit));
const branchRef = `refs/heads/${options.branch}`;

if (!gitOk(['check-ref-format', branchRef])) fail(`${options.branch} is not a branch name`);
if (['main', 'master'].includes(options.branch)) fail(`refusing to write ${options.branch}`);
for (const line of lines(git(['worktree', 'list', '--porcelain']))) {
  if (line === `branch ${branchRef}`) fail(`${options.branch} is checked out in a worktree`);
}
if (!gitOk(['merge-base', '--is-ancestor', base, tip]))
  fail('the base is not an ancestor of the tip');

// Every commit of the range, with what the build needs of it.
const commits = new Map();
{
  const format = ['%H', '%T', '%P', '%ad', '%cd', '%s'].join('%x1f') + '%x1e';
  const out = git(['log', '--date=raw', `--format=${format}`, `${base}..${tip}`]);
  for (const record of out.split('\x1e')) {
    const trimmed = record.replace(/^\n/, '');
    if (!trimmed) continue;
    const [sha, tree, parents, authorDate, committerDate, subject] = trimmed.split('\x1f');
    commits.set(sha, {
      sha,
      tree,
      parents: parents.split(' ').filter(Boolean),
      authorDate,
      committerDate,
      subject,
    });
  }
}
const baseInfo = (() => {
  const [tree, authorDate, committerDate] = git([
    'show',
    '-s',
    '--date=raw',
    '--format=%T%x1f%ad%x1f%cd',
    base,
  ])
    .trim()
    .split('\x1f');
  return { sha: base, tree, authorDate, committerDate };
})();

const seconds = (rawDate) => Number(rawDate.split(' ')[0]);

/** The calendar day a raw `<seconds> <+hhmm>` date falls on where it was made. */
function localDay(rawDate) {
  const [stamp, zone] = rawDate.split(' ');
  const sign = zone.startsWith('-') ? -1 : 1;
  const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  return new Date((Number(stamp) + offset * 60) * 1000).toISOString().slice(0, 10);
}

// The walk: first parents from the tip, the second parent at an unwrapped merge.
const steps = [];
for (let sha = tip; commits.has(sha); ) {
  steps.push(sha);
  const parents = commits.get(sha).parents;
  if (unwrap.has(sha)) {
    if (parents.length < 2) fail(`${sha} is not a merge and cannot be unwrapped`);
    sha = parents[1];
  } else {
    sha = parents[0];
  }
}
steps.reverse();
for (const sha of unwrap) {
  if (!steps.includes(sha)) fail(`${sha} is not on the walk from the tip`);
}

// What each step changes against the step before it: lines per path, and the
// submodule pointers it moves.
const stepDiffs = new Map();
{
  const input = steps
    .map((sha, index) => `${sha} ${index === 0 ? base : steps[index - 1]}`)
    .join('\n');
  const out = git(
    ['diff-tree', '--stdin', '--always', '-r', '--raw', '--numstat', '--no-renames'],
    {
      input: `${input}\n`,
    }
  );
  let current = null;
  for (const line of lines(out)) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      current = { lines: new Map(), gitlinks: [] };
      stepDiffs.set(line, current);
    } else if (line.startsWith(':')) {
      const [meta, path] = line.slice(1).split('\t');
      const [, newMode, , newSha] = meta.split(' ');
      if (newMode === GITLINK_MODE) current.gitlinks.push({ path, sha: newSha });
      else if (meta.split(' ')[0] === GITLINK_MODE) current.gitlinks.push({ path, sha: null });
    } else {
      const [added, deleted, path] = line.split('\t');
      const weight = added === '-' ? 1 : Number(added) + Number(deleted);
      current.lines.set(path, weight);
    }
  }
}

// The submodule pointers each step's tree carries, by path.
const gitlinksAt = new Map();
{
  let pointers = new Map();
  for (const line of lines(git(['ls-tree', '-r', base]))) {
    const [meta, path] = line.split('\t');
    const [mode, , sha] = meta.split(' ');
    if (mode === GITLINK_MODE) pointers.set(path, sha);
  }
  for (const sha of steps) {
    const moved = stepDiffs.get(sha)?.gitlinks ?? [];
    if (moved.length) {
      pointers = new Map(pointers);
      for (const { path, sha: pointer } of moved) {
        if (pointer) pointers.set(path, pointer);
        else pointers.delete(path);
      }
    }
    gitlinksAt.set(sha, pointers);
  }
}
const tipPointers = gitlinksAt.get(tip) ?? new Map();

// A pointer is reachable when a remote ref of the submodule's own clone, or the
// tip's pointer at the same path, has it as an ancestor. The clone is the one
// git keeps for the main checkout under its common directory.
const commonDir = resolve(git(['rev-parse', '--git-common-dir']).trim());
const reachableBySubmodule = new Map();
function reachable(path) {
  if (reachableBySubmodule.has(path)) return reachableBySubmodule.get(path);
  const gitDir = join(commonDir, 'modules', path);
  const set = new Set();
  if (existsSync(gitDir)) {
    const tips = lines(
      git(['for-each-ref', '--format=%(objectname)', 'refs/remotes/'], { gitDir })
    );
    const pin = tipPointers.get(path);
    if (pin && gitOk(['cat-file', '-e', `${pin}^{commit}`], { gitDir })) tips.push(pin);
    if (tips.length) {
      for (const sha of lines(git(['rev-list', ...tips], { gitDir }))) set.add(sha);
    }
  }
  reachableBySubmodule.set(path, set);
  return set;
}

const orphans = new Set();
if (options.orphans) {
  for (const line of lines(readFileSync(options.orphans, 'utf8'))) {
    const first = line.trim().split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/.test(first)) orphans.add(first);
  }
}
const orphansUntil = options.orphansUntil ? Date.parse(options.orphansUntil) / 1000 : Infinity;
if (Number.isNaN(orphansUntil)) fail(`--orphans-until ${options.orphansUntil} is not a date`);

/** The pointers of a tree committed at `committerDate` that no clone can fetch. */
function unreachablePointers(pointers, committerDate) {
  const acceptOrphans = seconds(committerDate) <= orphansUntil;
  const bad = [];
  for (const [path, sha] of pointers) {
    if (reachable(path).has(sha)) continue;
    if (acceptOrphans && orphans.has(sha)) continue;
    bad.push(`${path} at ${sha}`);
  }
  return bad;
}

// Labels: a recorded group, else the two leading directories changed most.
const groups = [];
if (options.groups) {
  for (const line of lines(readFileSync(options.groups, 'utf8'))) {
    const [prefix, ...label] = line.trim().split(/\s+/);
    if (/^[0-9a-f]{4,40}$/.test(prefix) && label.length) groups.push([prefix, label.join(' ')]);
  }
}
function area(path) {
  const parts = path.split('/');
  return parts.length === 1 ? 'root' : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}
function stepWeights(sha) {
  const group = groups.find(([prefix]) => sha.startsWith(prefix));
  const diff = stepDiffs.get(sha);
  const total = diff ? [...diff.lines.values()].reduce((sum, n) => sum + n, 0) : 0;
  if (group) return new Map([[group[1], Math.max(total, 1)]]);
  const weights = new Map();
  for (const [path, weight] of diff?.lines ?? []) {
    weights.set(area(path), (weights.get(area(path)) ?? 0) + weight);
  }
  return weights;
}

function dominant(weights) {
  let best = 'root';
  let bestWeight = -1;
  for (const [label, weight] of weights) {
    if (weight > bestWeight || (weight === bestWeight && label < best)) {
      best = label;
      bestWeight = weight;
    }
  }
  return best;
}

// The run map of the last build.
const previous = [];
if (!options.fresh && existsSync(options.runMap)) {
  for (const line of lines(readFileSync(options.runMap, 'utf8'))) {
    if (line.startsWith('#')) continue;
    const [end, commit, label, ...message] = line.split('\t');
    previous.push({
      end,
      commit: commit === '-' ? null : commit,
      label,
      message: message.join(' '),
    });
  }
}
const stepIndex = new Map(steps.map((sha, index) => [sha, index]));
{
  let last = -1;
  for (const run of previous) {
    const index = stepIndex.get(run.end);
    if (index === undefined || index <= last) {
      fail(
        `the run map ends a run on ${run.end}, which is not on the walk from the tip in order; ` +
          'rerun with --fresh to slice the history again'
      );
    }
    last = index;
  }
}

// Kept runs, and how many runs the steps after them may take. A fresh build
// leaves the reserve free, a later one takes half of what is left, and once
// the cap is spent the last run is reopened to take the new steps with it.
const kept = previous.slice();
const lastKeptEnd = () => (kept.length ? stepIndex.get(kept.at(-1).end) : -1);
let budget;
let reopened = null;
if (lastKeptEnd() === steps.length - 1) {
  budget = 0;
} else if (kept.length === 0) {
  budget = options.max - options.reserve;
} else if (kept.length >= options.max) {
  reopened = kept.splice(options.max - 1).at(0);
  budget = 1;
} else {
  budget = Math.max(1, Math.floor((options.max - kept.length) / 2));
}
const newSteps = steps.slice(lastKeptEnd() + 1);

// Ends a run may take: dates no earlier than the previous end's, and pointers a
// clone can fetch. Taking every one that qualifies keeps them mutually ordered,
// so joining runs later never breaks the order.
const atoms = [];
{
  const start = lastKeptEnd() + 1;
  let lastEnd = kept.length ? commits.get(kept.at(-1).end) : baseInfo;
  let atomStart = start;
  const ends = [];
  for (let index = start; index < steps.length; index++) {
    const step = commits.get(steps[index]);
    const ordered =
      seconds(step.authorDate) >= seconds(lastEnd.authorDate) &&
      seconds(step.committerDate) >= seconds(lastEnd.committerDate);
    const fetchable =
      unreachablePointers(gitlinksAt.get(step.sha), step.committerDate).length === 0;
    if (ordered && fetchable) {
      ends.push(index);
      lastEnd = step;
    }
  }
  if (newSteps.length && ends.at(-1) !== steps.length - 1) {
    // The tip has to end the last run. Drop the ends dated after it.
    const tipStep = commits.get(tip);
    while (
      ends.length &&
      (seconds(commits.get(steps[ends.at(-1)]).authorDate) > seconds(tipStep.authorDate) ||
        seconds(commits.get(steps[ends.at(-1)]).committerDate) > seconds(tipStep.committerDate))
    ) {
      ends.pop();
    }
    ends.push(steps.length - 1);
  }
  for (const end of ends) {
    const weights = new Map();
    for (let index = atomStart; index <= end; index++) {
      for (const [label, weight] of stepWeights(steps[index])) {
        weights.set(label, (weights.get(label) ?? 0) + weight);
      }
    }
    atoms.push({
      start: atomStart,
      end,
      weights,
      day: localDay(commits.get(steps[end]).committerDate),
    });
    atomStart = end + 1;
  }
}

function join2(a, b) {
  const weights = new Map(a.weights);
  for (const [label, weight] of b.weights) weights.set(label, (weights.get(label) ?? 0) + weight);
  return { start: a.start, end: b.end, weights, day: b.day, sameDay: a.day === b.day };
}

// A step that changes nothing, such as a merge whose tree is its branch's,
// has no area of its own and stays with the run before it.
let runs = [];
for (const atom of atoms) {
  const last = runs.at(-1);
  const sameArea =
    atom.weights.size === 0 || dominant(last?.weights ?? new Map()) === dominant(atom.weights);
  if (last && last.day === atom.day && sameArea) {
    runs[runs.length - 1] = join2(last, atom);
  } else {
    runs.push({ ...atom });
  }
}
// Join the cheapest neighbours until the count fits: same day before
// different days, then the fewest steps.
while (runs.length > budget && runs.length > 1) {
  let best = -1;
  let bestCost = null;
  for (let i = 0; i + 1 < runs.length; i++) {
    const cost = [runs[i].day === runs[i + 1].day ? 0 : 1, runs[i + 1].end - runs[i].start + 1];
    if (!bestCost || cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) {
      best = i;
      bestCost = cost;
    }
  }
  runs.splice(best, 2, join2(runs[best], runs[best + 1]));
}
if (reopened && runs.length) runs[0].message = reopened.message;

// Default messages: the subject of the commit that changed most in the run.
const changed = new Map();
{
  const out = git(['log', '--no-merges', '--numstat', '--format=%x1e%H', `${base}..${tip}`]);
  for (const record of out.split('\x1e')) {
    const [sha, ...rest] = lines(record);
    if (!sha) continue;
    let total = 0;
    for (const line of rest) {
      const [added, deleted] = line.split('\t');
      total += added === '-' ? 1 : Number(added) + Number(deleted);
    }
    changed.set(sha, total);
  }
}

function members(fromSha, toSha) {
  return lines(git(['rev-list', toSha, `^${fromSha}`]));
}

function defaultMessage(fromSha, toSha) {
  let best = null;
  for (const sha of members(fromSha, toSha)) {
    if (!changed.has(sha)) continue;
    if (!best || changed.get(sha) > changed.get(best)) best = sha;
  }
  // A pull request number is a reference into a tracker, which a message never
  // carries, and the subject starts with a capital like any other.
  const subject = commits
    .get(best ?? toSha)
    .subject.replace(/\s+/g, ' ')
    .replace(/\s*\(#\d+\)$/, '')
    .trim();
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

const plan = kept.map((run) => ({ ...run }));
for (const run of runs) {
  const fromSha = plan.length ? plan.at(-1).end : base;
  const end = steps[run.end];
  plan.push({
    end,
    commit: null,
    label: dominant(run.weights),
    message: run.message ?? defaultMessage(fromSha, end),
  });
}

// Build: keep each commit the map names while it still matches what the run
// would write, and write the rest.
const sign = (() => {
  try {
    return git(['config', '--bool', 'commit.gpgsign']).trim() === 'true';
  } catch {
    return false;
  }
})();
let parent = base;
let rebuilt = 0;
for (const run of plan) {
  const step = commits.get(run.end);
  let reuse = false;
  if (run.commit && gitOk(['cat-file', '-e', `${run.commit}^{commit}`])) {
    const [tree, parents, authorDate, committerDate, message] = git([
      'show',
      '-s',
      '--date=raw',
      '--format=%T%x1f%P%x1f%ad%x1f%cd%x1f%B',
      run.commit,
    ]).split('\x1f');
    reuse =
      tree === step.tree &&
      parents === parent &&
      authorDate === step.authorDate &&
      committerDate === step.committerDate &&
      message.trim() === run.message;
  }
  if (!reuse) {
    run.commit = git(
      ['commit-tree', sign ? '-S' : '--no-gpg-sign', '-p', parent, '-m', run.message, step.tree],
      { env: { GIT_AUTHOR_DATE: step.authorDate, GIT_COMMITTER_DATE: step.committerDate } }
    ).trim();
    rebuilt++;
  }
  parent = run.commit;
}
const candidate = parent;

// The checks. Any failure leaves the branch where it was.
const failures = [];
const built = lines(
  git(['log', '--reverse', '--date=raw', '--format=%H%x1f%ad%x1f%cd', `${base}..${candidate}`])
).map((line) => {
  const [sha, authorDate, committerDate] = line.split('\x1f');
  return { sha, authorDate, committerDate };
});
if (built.length > options.max) failures.push(`${built.length} commits, more than ${options.max}`);
if (!gitOk(['diff', '--quiet', tip, candidate, '--'])) {
  failures.push(`the tree of ${candidate} differs from the tip ${tip}`);
}
for (const [index, after] of built.entries()) {
  const before = index === 0 ? baseInfo : built[index - 1];
  if (
    seconds(after.authorDate) < seconds(before.authorDate) ||
    seconds(after.committerDate) < seconds(before.committerDate)
  ) {
    failures.push(`${after.sha} is dated earlier than its parent`);
  }
}
for (const run of plan) {
  const step = commits.get(run.end);
  for (const pointer of unreachablePointers(gitlinksAt.get(run.end), step.committerDate)) {
    failures.push(`${run.commit} pins ${pointer}, which no submodule ref reaches`);
  }
}
{
  const guard = spawnSync('bash', [PRIVATE_DATA_GUARD, '--range', `${base}..${candidate}`], {
    encoding: 'utf8',
    env: GIT_ENV,
  });
  if (guard.error) {
    failures.push(`the private-data guard did not start: ${guard.error.message}`);
  } else if (guard.status !== 0) {
    failures.push(`the private-data guard refused the range:\n${guard.stderr.trimEnd()}`);
  }
}

console.log(
  `${steps.length} steps from ${base.slice(0, 9)} to ${tip.slice(0, 9)}, ` +
    `${plan.length} runs, ${plan.length - rebuilt} kept, ${rebuilt} written`
);
for (const [index, run] of plan.entries()) {
  const step = commits.get(run.end);
  console.log(
    `${String(index + 1).padStart(3)} ${run.commit.slice(0, 9)} ${localDay(step.committerDate)} ` +
      `${run.label}: ${run.message}`
  );
}

if (failures.length) {
  console.error(`consolidate-history: ${options.branch} left where it was:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('checks: count, tree, dates, submodule pointers and private data passed');

if (options.dryRun) {
  console.log(`dry run: ${options.branch} would be ${candidate}`);
  process.exit(0);
}

const current = gitOk(['rev-parse', '--verify', '-q', branchRef])
  ? git(['rev-parse', '--verify', branchRef]).trim()
  : '';
git(['update-ref', '-m', 'consolidate-history', branchRef, candidate, current]);
console.log(
  `${options.branch} ${current ? current.slice(0, 9) : '(new)'} -> ${candidate.slice(0, 9)}`
);

writeFileSync(
  options.runMap,
  '# end step\tcommit\tlabel\tmessage\n' +
    plan.map((run) => [run.end, run.commit, run.label, run.message].join('\t')).join('\n') +
    '\n'
);

if (options.commitMap) {
  const rows = [];
  let from = base;
  for (const run of plan) {
    for (const sha of members(from, run.end)) rows.push(`${sha} ${run.commit}`);
    from = run.end;
  }
  rows.sort();
  writeFileSync(options.commitMap, `${'old'.padEnd(41)}new\n${rows.join('\n')}\n`);
}

#!/usr/bin/env node
// Which Test and Build jobs a change has to run, and whether CI Required and
// Build Required pass on what they returned.
//
//   ci-required.mjs scope        writes scoped=true|false: whether this run may
//                                skip a job its change cannot reach
//   ci-required.mjs plan         writes areas, run and zones for the jobs to read
//   ci-required.mjs check        judges the job results, exits 1 when one fails
//   ci-required.mjs build-plan   writes native=true|false for the Build jobs
//   ci-required.mjs build-check  judges the Build results, exits 1 when one fails
//
// Only a Dependabot patch or minor pull request is scoped. A push to main and
// every other pull request run every job, and so does a Dependabot major, which
// a person merges on these checks and which can move what a library does with
// dates, and a Dependabot change to this workflow or an action it runs, since
// the jobs skipped would be the ones whose steps moved. The update type comes
// from dependabot/fetch-metadata, and one that is missing or unreadable counts
// as a major, so a failed read runs everything. A scoped run asks scripts/ci-areas.mjs which areas the
// change reaches, and each job runs when one of its areas is reached.
//
// The check reads each job with its areas: a job skipped while an area of its
// is reached fails, one skipped while none is reached passes, and anything
// but success or that skip fails. An area that is missing or unreadable
// counts as reached, so a failed plan cannot pass a skipped job.
//
// Build is scoped on every pull request, not only Dependabot's. One that
// reaches neither native code nor the engine crate, both of which the Gradle
// and Xcode builds compile, skips both builds and runs a bundle check of the
// Android entry instead, so a change that breaks the import graph still
// fails. A Dependabot major builds natively whatever it reaches. Build Required reads each build against that answer: a build
// skipped while the change is native fails, and so does a bundle check
// skipped or red while it is not. A plan that names nothing counts as native.
//
// On a Dependabot pull request, both checks then drop a job that failed on
// the pull request and on main's latest finished run, which
// scripts/judge-against-main.mjs reads, and print what they dropped. A major
// is judged the same way: main's run is the full set of jobs a major now
// runs, so a job red on both is red for a reason the bump did not bring.
//
// `scope` reads EVENT, AUTHOR and UPDATE_TYPE, `plan` those and runs `git
// diff` against the merge commit's first parent, `check` reads EVENT, AUTHOR,
// CHANGES, AREAS and one variable per job named in RESULT_VARIABLES.
// `build-plan` reads EVENT, AUTHOR and UPDATE_TYPE and diffs the same way, `build-check` reads EVENT, AUTHOR,
// CHANGES, NATIVE and one variable per job named in BUILD_RESULT_VARIABLES. Each writes `key=value`
// lines to `$GITHUB_OUTPUT`, or to stdout when that is unset.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { changedPaths, ciAreas, lockfileAt } from './ci-areas.mjs';
import { judgeFailures } from './judge-against-main.mjs';

const DEPENDABOT = 'dependabot[bot]';

/** The Dependabot update types a run may narrow for. */
const NARROW_UPDATES = ['version-update:semver-patch', 'version-update:semver-minor'];

/** The areas each Test job can see. The bindings tool is an npm package. */
export const JOBS = {
  jest: ['appJs'],
  js: ['appJs'],
  rust: ['rust', 'appJs'],
  'rust-lint': ['rust', 'appJs'],
  'rust-advisories': ['rust'],
  'verify-bindings': ['rust', 'appJs', 'oauthProxy'],
};

/** The environment variable `check` reads each job's result from. */
export const RESULT_VARIABLES = {
  jest: 'JEST',
  js: 'JS',
  rust: 'RUST',
  'rust-lint': 'RUST_LINT',
  'rust-advisories': 'RUST_ADVISORIES',
  'verify-bindings': 'VERIFY_BINDINGS',
};

/** Each Test job's displayed name, which its runs are listed under. */
export const JOB_NAMES = {
  jest: 'Jest',
  js: 'JS Checks',
  rust: 'Rust Tests',
  'rust-lint': 'Rust Lint',
  'rust-advisories': 'rust-advisories',
  'verify-bindings': 'Verify Bindings',
};

const PLANNED_AREAS = [...new Set(Object.values(JOBS).flat())];

/**
 * The zones the app suite runs under, furthest east and west of UTC. The
 * second exists for app code that mixes UTC and local fields, which a
 * library bump does not move.
 */
export const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles'];

/** The files Test's own jobs run, whose change every job has to meet. */
const OWN_FILES = [
  '.github/workflows/test.yml',
  '.github/workflows/rust-advisories.yml',
  '.github/actions/',
];

function ownFile(path) {
  return OWN_FILES.some((own) => (own.endsWith('/') ? path.startsWith(own) : path === own));
}

/** Whether a pull request is a Dependabot major, an unread update type counting as one. */
export function dependabotMajor({ author, updateType }) {
  return author === DEPENDABOT && !NARROW_UPDATES.includes(updateType);
}

/** Whether a run may skip a job its change cannot reach. */
export function scoped({ event, author, updateType }) {
  return (
    event === 'pull_request' && author === DEPENDABOT && !dependabotMajor({ author, updateType })
  );
}

function reached(areas, area) {
  return areas?.[area] !== false;
}

/** Whether each job runs, given the areas reached. */
export function jobsToRun(areas) {
  return Object.fromEntries(
    Object.entries(JOBS).map(([job, own]) => [job, own.some((area) => reached(areas, area))])
  );
}

/**
 * The plan the Test jobs read.
 *
 * @param {object} run
 * @param {string} run.event the event that started the workflow
 * @param {string} [run.author] the pull request's author
 * @param {string} [run.updateType] Dependabot's update type, as fetch-metadata names it
 * @param {string[]} [run.paths] the changed paths, read only when scoped
 * @param {Record<string, boolean>} [run.areas] ciAreas over those paths
 * @returns {{areas: Record<string, boolean>, run: Record<string, boolean>, zones: string[]}}
 */
export function plan({ event, author, updateType, paths = [], areas = {} }) {
  const narrow = scoped({ event, author, updateType }) && !paths.some(ownFile);
  const planned = Object.fromEntries(
    PLANNED_AREAS.map((area) => [area, narrow ? areas[area] === true : true])
  );
  const pureJs = narrow && areas.native === false;
  return { areas: planned, run: jobsToRun(planned), zones: pureJs ? ZONES.slice(0, 1) : ZONES };
}

/**
 * Why CI Required fails, each with the job and the result it read, empty when
 * it passes.
 *
 * @param {object} outcome
 * @param {string} outcome.changes the planning job's result
 * @param {Record<string, boolean>} [outcome.areas] the areas the plan named
 * @param {Record<string, string>} outcome.results each job's result
 * @returns {{job: string, result: string, message: string}[]}
 */
export function ciFailures({ changes, areas, results }) {
  const failures = [];
  if (changes !== 'success') {
    failures.push(failure('changes', changes, `the change detection ended ${changes || 'unset'}`));
  }
  const required = jobsToRun(areas);
  for (const job of Object.keys(JOBS)) {
    const result = results[job];
    if (result === 'success') continue;
    if (result === 'skipped' && !required[job]) continue;
    failures.push(
      failure(
        job,
        result,
        result === 'skipped'
          ? `${job} was skipped, and the change reaches ${JOBS[job].join(' or ')}`
          : `${job} ended ${result || 'unset'}`
      )
    );
  }
  return failures;
}

/** Why CI Required fails, empty when it passes. */
export function ciRequired(outcome) {
  return ciFailures(outcome).map((f) => f.message);
}

/** The environment variable `build-check` reads each Build job's result from. */
export const BUILD_RESULT_VARIABLES = {
  'build-android': 'ANDROID',
  'build-ios': 'IOS',
  'bundle-check': 'BUNDLE',
  'e2e-gate': 'GATE',
};

/** Each Build job's displayed name, which its runs are listed under. */
export const BUILD_JOB_NAMES = {
  'build-android': 'Build Android',
  'build-ios': 'Build iOS',
  'bundle-check': 'Bundle Check',
  'e2e-gate': 'E2E Gate',
};

const NATIVE_BUILDS = ['build-android', 'build-ios'];

/** Whether Build runs the Gradle and Xcode builds, given the areas reached. */
export function buildsNative({ event, author, updateType, areas }) {
  if (event !== 'pull_request' || dependabotMajor({ author, updateType })) return true;
  return reached(areas, 'native') || reached(areas, 'rust');
}

/**
 * Why Build Required fails, each with the job and the result it read, empty
 * when it passes.
 *
 * @param {object} outcome
 * @param {string} outcome.event the event that started the workflow
 * @param {string} [outcome.ref] the ref it ran on
 * @param {string} outcome.changes the planning job's result
 * @param {boolean} [outcome.native] whether the plan built natively, unset counting as true
 * @param {Record<string, string>} outcome.results each job's result
 * @returns {{job: string, result: string, message: string}[]}
 */
export function buildFailures({ event, ref, changes, native, results }) {
  const failures = [];
  if (changes !== 'success') {
    failures.push(failure('changes', changes, `the change detection ended ${changes || 'unset'}`));
  }
  const builds = native !== false;
  // The E2E gate tests the production build after a push to main or to a ci/
  // branch, never a release tag, a dispatch or a pull request.
  const required = {
    'build-android': builds,
    'build-ios': builds,
    'bundle-check': !builds,
    'e2e-gate':
      event === 'push' && (ref === 'refs/heads/main' || ref?.startsWith('refs/heads/ci/') === true),
  };
  for (const job of Object.keys(BUILD_RESULT_VARIABLES)) {
    const result = results[job];
    if (result === 'success') continue;
    if (result === 'skipped' && !required[job]) continue;
    if (result !== 'skipped')
      failures.push(failure(job, result, `${job} ended ${result || 'unset'}`));
    else if (NATIVE_BUILDS.includes(job)) {
      failures.push(
        failure(job, result, `${job} was skipped, and the change reaches native code or the engine`)
      );
    } else failures.push(failure(job, result, `${job} was skipped`));
  }
  return failures;
}

/** Why Build Required fails, empty when it passes. */
export function buildRequired(outcome) {
  return buildFailures(outcome).map((f) => f.message);
}

function failure(job, result, message) {
  return { job, result: result || 'unset', message };
}

function changeAreas() {
  // A pull request checks out its merge commit, whose first parent is the
  // base it merges into.
  const root = process.cwd();
  const base = 'HEAD^1';
  const paths = changedPaths(root, base);
  return {
    paths,
    areas: ciAreas({ paths, base: lockfileAt(root, base), head: lockfileAt(root, 'HEAD'), root }),
  };
}

function parseAreas(raw) {
  try {
    const areas = JSON.parse(raw ?? '');
    return areas && typeof areas === 'object' ? areas : undefined;
  } catch {
    return undefined;
  }
}

function write(lines) {
  const body = Object.entries(lines)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`)
    .join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, body);
  else process.stdout.write(body);
}

function report(failures) {
  for (const { message } of failures) console.log(`::error::${message}`);
  if (failures.length > 0) process.exit(1);
}

function main([command]) {
  const env = process.env;
  const run = { event: env.EVENT, author: env.AUTHOR, updateType: env.UPDATE_TYPE };
  if (command === 'scope') {
    write({ scoped: String(scoped(run)) });
  } else if (command === 'plan') {
    if (scoped(run)) Object.assign(run, changeAreas());
    const { areas, run: jobs, zones } = plan(run);
    console.error(`areas ${JSON.stringify(areas)} zones ${JSON.stringify(zones)}`);
    write({ areas, run: jobs, zones });
  } else if (command === 'check') {
    const results = Object.fromEntries(
      Object.entries(RESULT_VARIABLES).map(([job, name]) => [job, env[name]])
    );
    console.log(`changes=${env.CHANGES} areas=${env.AREAS} ${JSON.stringify(results)}`);
    const failures = judgeFailures({
      ...run,
      workflow: 'test.yml',
      failures: ciFailures({ changes: env.CHANGES, areas: parseAreas(env.AREAS), results }),
      names: JOB_NAMES,
    });
    report(failures);
  } else if (command === 'build-plan') {
    const areas =
      run.event === 'pull_request' && !dependabotMajor(run) ? changeAreas().areas : undefined;
    const native = buildsNative({ ...run, areas });
    console.error(`areas ${JSON.stringify(areas ?? 'all')} native ${native}`);
    write({ native: String(native) });
  } else if (command === 'build-check') {
    const results = Object.fromEntries(
      Object.entries(BUILD_RESULT_VARIABLES).map(([job, name]) => [job, env[name]])
    );
    console.log(
      `event=${env.EVENT} changes=${env.CHANGES} native=${env.NATIVE} ${JSON.stringify(results)}`
    );
    const failures = judgeFailures({
      ...run,
      workflow: 'build.yml',
      failures: buildFailures({
        event: env.EVENT,
        ref: env.REF,
        changes: env.CHANGES,
        native: env.NATIVE !== 'false',
        results,
      }),
      names: BUILD_JOB_NAMES,
    });
    report(failures);
  } else {
    process.stderr.write('ci-required: scope, plan, check, build-plan or build-check\n');
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

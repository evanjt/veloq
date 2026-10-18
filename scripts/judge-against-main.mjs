#!/usr/bin/env node
// Judges a Dependabot pull request's red jobs against main, for CI Required
// and Build Required. The decision is in lib/judge-against-main.js; this reads
// this run's jobs and main's latest finished run of the same workflow through
// `gh`, drops the failures main was already red on, and writes the verdicts as
// a table to the step summary, so a merged pull request shows what it was
// excused from. A pull request a person opened is judged strictly and reads
// nothing.
//
// It reads GITHUB_RUN_ID, GH_REPO and GH_TOKEN, which needs `actions: read`.
// When `gh` fails, every failure stands.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { DEPENDABOT, baselineRun, judgeAgainstMain, jobIdOf, excuseFailures, summaryTable } =
  createRequire(import.meta.url)('./lib/judge-against-main.js');

/** Main's newest runs to look through for one that passed or failed. */
const BASELINE_SEARCH = 20;

const json = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

function runJobs(runId) {
  return json('run', 'view', String(runId), '--json', 'jobs').jobs ?? [];
}

function mainBaseline(workflow) {
  const runs = json(
    'run',
    'list',
    '--workflow',
    workflow,
    '--branch',
    'main',
    '--event',
    'push',
    '--limit',
    String(BASELINE_SEARCH),
    '--json',
    'databaseId,status,conclusion,updatedAt'
  );
  const run = baselineRun(runs);
  if (run == null) return null;
  const jobs = Object.fromEntries(runJobs(run.databaseId).map((job) => [job.name, job.conclusion]));
  return { completedAt: run.updatedAt, jobs };
}

function summarise(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else console.log(markdown);
}

/**
 * The failures that stand once inherited jobs are dropped.
 *
 * @param {object} input
 * @param {string} input.workflow the workflow file, as `gh run list --workflow` takes it
 * @param {string} input.event the event that started the run
 * @param {string} input.author the pull request's author
 * @param {{job: string, result: string, message: string}[]} input.failures
 *   the aggregator's failures by workflow job id
 * @param {Record<string, string>} input.names each job id's displayed name
 */
export function judgeFailures({ workflow, event, author, failures, names }) {
  if (event !== 'pull_request' || author !== DEPENDABOT) return failures;
  if (!failures.some((failure) => failure.result === 'failure')) return failures;
  try {
    const failed = runJobs(process.env.GITHUB_RUN_ID)
      .filter((job) => job.conclusion === 'failure' && jobIdOf(job.name, names) !== undefined)
      .map((job) => job.name);
    const verdict = judgeAgainstMain({
      author,
      failed,
      main: mainBaseline(workflow),
      now: Date.now(),
      names,
    });
    summarise(summaryTable(verdict));
    for (const row of verdict.rows) {
      if (row.verdict === 'inherited') console.log(`inherited: ${row.job} is red on main too`);
    }
    return excuseFailures(failures, verdict.rows, names);
  } catch (error) {
    console.log(`::warning::could not read main's jobs, judging strictly: ${error.message}`);
    return failures;
  }
}

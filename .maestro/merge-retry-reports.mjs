#!/usr/bin/env node
// Fold the retry pass into the suite's own junit report.
//
// Usage: merge-retry-reports.mjs <report.xml> <retry-dir> <flow>...
//
// `run-suite.sh` retries each failed flow into `<retry-dir>/<flow>.xml` and
// decides the gate on those, while the step summary and the junit check read
// the named report. Left alone, that report is the first pass, so a suite the
// retries recovered still read as 78 failures under a green job. Each retried
// testcase is replaced by its retry result and the counts are recomputed, so
// the report says what the gate decided.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTCASE = /<testcase\b[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g;
// `\s` before `name` so that `classname` is not read as the name.
const nameOf = (element) => element.match(/\sname="([^"]*)"/)?.[1];
const failed = (element) => /<(failure|error)\b/.test(element);

/** Set `attribute` on an opening tag, when the tag already carries it. */
function recount(tag, attribute, value) {
  return tag.replace(new RegExp(`(\\s${attribute}=")\\d+(")`), `$1${value}$2`);
}

/** Recompute `tests` and `failures` on one suite element from its testcases. */
function recountSuite(suite) {
  const cases = suite.match(TESTCASE) ?? [];
  return suite.replace(/^<testsuite\b[^>]*>/, (tag) =>
    recount(recount(tag, 'tests', cases.length), 'failures', cases.filter(failed).length)
  );
}

export function merge(report, retries) {
  let merged = report.replace(TESTCASE, (element) => retries.get(nameOf(element)) ?? element);
  merged = merged.replace(/<testsuite\b[^>]*>[\s\S]*?<\/testsuite>/g, recountSuite);

  // A root `testsuites` carries the totals too, and a reader that takes the
  // first `tests=` in the file reads the root's.
  const all = merged.match(TESTCASE) ?? [];
  return merged.replace(/<testsuites\b[^>]*>/, (tag) =>
    recount(recount(tag, 'tests', all.length), 'failures', all.filter(failed).length)
  );
}

function main() {
  const [report, retryDir, ...flows] = process.argv.slice(2);
  if (!report || !retryDir || !existsSync(report)) return;

  const retries = new Map();
  for (const flow of flows) {
    const file = join(retryDir, `${flow}.xml`);
    if (!existsSync(file)) continue;
    const retried = readFileSync(file, 'utf8').match(TESTCASE) ?? [];
    const element = retried.find((candidate) => nameOf(candidate) === flow);
    if (element) retries.set(flow, element);
  }
  if (retries.size === 0) return;

  writeFileSync(report, merge(readFileSync(report, 'utf8'), retries));
}

main();

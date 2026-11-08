#!/usr/bin/env node
// Three store shots carry a headline the capture has to prove.
//
// The section shot shows the page of the section the notification names, so the
// page is opened from the ride's own section list and never from the library-wide
// list, whose first row is any section. The insights shot shows one insight opened
// to its method, so the flow opens a row and expands the method. The recording
// shot shows a ride with its track, so it waits for a distance above zero.

import { resolve } from 'node:path';
import { loadAll } from 'js-yaml';
import { trackedText } from './lib/indexedSources.mjs';

const FLOW = '.maestro/store-capture.yaml';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const failures = [];

const text = trackedText(root, FLOW);
let flow = [];
if (text === undefined) {
  failures.push(`${FLOW}: not in the tree`);
} else {
  try {
    flow = loadAll(text).find(Array.isArray) ?? [];
  } catch (error) {
    failures.push(`${FLOW}: ${error.message}`);
  }
}

const stemOf = (step) => /store-capture\/([^"]+)$/.exec(step?.takeScreenshot ?? '')?.[1];
const tapsId = (step, id) => step?.tapOn?.id === id;
const sees = (step, id) =>
  step?.extendedWaitUntil?.visible?.id === id || step?.assertVisible?.id === id;

// The steps from the previous shot up to this one.
const windowBefore = (stem) => {
  const end = flow.findIndex((step) => stemOf(step) === stem);
  if (end === -1) return null;
  let start = end;
  while (start > 0 && stemOf(flow[start - 1]) === undefined) start -= 1;
  return flow.slice(start, end);
};

const checks = {
  '02-section': (steps) => {
    const repost = steps.findIndex((s) => tapsId(s, 'activity-regenerate-notification-delayed'));
    const opened = steps.findIndex((s) => tapsId(s, 'section-inline-plot-0'));
    if (steps.some((s) => tapsId(s, 'section-row-0'))) {
      return 'opens the first row of the library-wide list, which need not be the notified section';
    }
    if (repost === -1 || opened < repost) {
      return 'does not open the ride section list entry after the notification is posted';
    }
    return null;
  },
  '06-insights': (steps) => {
    const row = steps.findIndex((s) => tapsId(s, 'insight-line'));
    const sheet = steps.findIndex((s) => sees(s, 'insight-detail-sheet'));
    const method = steps.findIndex((s) => tapsId(s, 'methodology-toggle'));
    if (row === -1 || sheet < row || method < sheet) {
      return 'does not open an insight and expand its method';
    }
    return null;
  },
  '08-recording': (steps) =>
    steps.some((s) => /^0 \(m\|ft\)$/.test(s?.extendedWaitUntil?.notVisible ?? ''))
      ? null
      : 'does not wait for a distance above zero',
};

for (const [stem, check] of Object.entries(checks)) {
  const steps = windowBefore(stem);
  if (steps === null) {
    failures.push(`${FLOW}: no shot ${stem}`);
    continue;
  }
  const problem = check(steps);
  if (problem) failures.push(`${FLOW}: the ${stem} shot ${problem}`);
}

if (failures.length > 0) {
  console.error(`lint-maestro-store-shots: ${failures.length} problem(s) in the store capture:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

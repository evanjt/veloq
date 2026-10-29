#!/usr/bin/env node
// The store capture must never photograph debug UI.
//
// Debug mode puts two repost buttons on the activity page, and the flow switches
// debug mode on for the section shot and off again after it. A shot taken while
// debug mode is on carries them into the store set. So every shot is preceded by
// the helper that asserts both buttons are absent, the helper asserts both ids,
// and the step that switches debug mode off is followed by an assertion that the
// switch reads off, rather than a tap that is skipped when the switch is missed.

import { resolve } from 'node:path';
import { loadAll } from 'js-yaml';
import { trackedText } from './lib/indexedSources.mjs';

const FLOW = '.maestro/store-capture.yaml';
const HELPER = 'helpers/assert-debug-ui-absent.yaml';
const DEBUG_IDS = ['activity-regenerate-notification', 'activity-regenerate-notification-delayed'];
const SWITCH = 'settings-debug-switch';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const failures = [];

const readYaml = (path) => {
  const text = trackedText(root, path);
  if (text === undefined) {
    failures.push(`${path}: not in the tree`);
    return [];
  }
  try {
    return loadAll(text);
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
    return [];
  }
};

const commandsOf = (docs) => docs.find(Array.isArray) ?? [];

// The helper must be a flow of its own that asserts both debug ids are absent.
const helperAsserts = readYaml(`.maestro/${HELPER}`);
const asserted = new Set(
  commandsOf(helperAsserts)
    .map((step) => step?.assertNotVisible?.id)
    .filter((id) => typeof id === 'string')
);
for (const id of DEBUG_IDS) {
  if (!asserted.has(id)) failures.push(`.maestro/${HELPER} does not assert ${id} is absent`);
}

const isShot = (step) => typeof step?.takeScreenshot !== 'undefined';
const runsHelper = (step) => step?.runFlow?.file === HELPER;
const switchesDebugOff = (step) =>
  step?.runFlow?.when?.visible?.id === SWITCH && step.runFlow.when.visible.checked === true;
const assertsSwitchOff = (step) =>
  step?.assertVisible?.id === SWITCH && step.assertVisible.checked === false;

const flow = commandsOf(readYaml(FLOW));
flow.forEach((step, index) => {
  if (isShot(step) && !runsHelper(flow[index - 1])) {
    failures.push(`${FLOW}: the shot at step ${index + 1} is not preceded by ${HELPER}`);
  }
  if (switchesDebugOff(step) && !assertsSwitchOff(flow[index + 1])) {
    failures.push(
      `${FLOW}: step ${index + 1} switches debug mode off without asserting the switch reads off after it`
    );
  }
});

if (failures.length > 0) {
  console.error(`lint-maestro-capture-debug: ${failures.length} problem(s) in the store capture:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

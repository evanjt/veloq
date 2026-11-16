#!/usr/bin/env node
// A flow that taps the debug switch without first scrolling the settings screen to it.
//
// The switch appears under the version line only after five taps on that line, so it
// lands below the fold of a settings screen the flow has just scrolled to the version.
// Maestro reads an element off screen as not found, and the flow stops at the tap. A
// scroll to the switch comes first, as store-capture does.

import { resolve } from 'node:path';
import { loadAll } from 'js-yaml';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const SWITCH = 'settings-debug-switch';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const flows = indexedSources(root, ['.maestro/*.yaml']);
refuseEmptyListing(flows, 'lint-maestro-debug-switch');

/** Whether a command list taps the switch before any scroll has reached it. */
function tapsUnscrolledSwitch(steps, state = { scrolled: false }) {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.scrollUntilVisible?.element?.id === SWITCH) state.scrolled = true;
    if (step.tapOn?.id === SWITCH && !state.scrolled) return true;
    if (
      Array.isArray(step.runFlow?.commands) &&
      tapsUnscrolledSwitch(step.runFlow.commands, state)
    ) {
      return true;
    }
  }
  return false;
}

const failures = [];
for (const [file, bytes] of flows) {
  const commands = loadAll(bytes.toString('utf8')).find(Array.isArray) ?? [];
  if (tapsUnscrolledSwitch(commands)) failures.push(file);
}

if (failures.length > 0) {
  console.error(
    `lint-maestro-debug-switch: ${failures.length} flow(s) tap the debug switch before scrolling to it:`
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    'Add `scrollUntilVisible` on settings-debug-switch, then the swipe store-capture uses, before the tap.'
  );
  process.exit(1);
}

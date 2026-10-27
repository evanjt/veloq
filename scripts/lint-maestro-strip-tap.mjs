#!/usr/bin/env node
// A flow that opens the insights screen and then taps its Sections tab.
//
// The strip sits under a header that resizes for a moment after `routes-screen`
// is visible. A tap taken then lands on the search field below the strip and the
// tab never opens. The sections link opens the tab with no tap, so a flow that
// needs the tab follows `veloq://insights?tab=sections` through its helper.

import { resolve } from 'node:path';
import { loadAll } from 'js-yaml';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const INSIGHTS_HELPERS = ['helpers/navigate-to-routes.yaml', 'helpers/navigate-to-sections.yaml'];
const OPEN_LINK = 'helpers/open-link.yaml';
const INSIGHTS_LINK = /^veloq:\/\/insights\?tab=(routes|sections)$/;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const flows = indexedSources(root, ['.maestro/*.yaml']);
refuseEmptyListing(flows, 'lint-maestro-strip-tap');

const linkOf = (step) => {
  if (typeof step.openLink === 'string') return step.openLink;
  if (step.runFlow?.file === OPEN_LINK) return step.runFlow.env?.LINK;
  return undefined;
};

const opensInsights = (step) =>
  INSIGHTS_HELPERS.includes(step.runFlow?.file) || INSIGHTS_LINK.test(linkOf(step) ?? '');

const leavesInsights = (step) => {
  if (step.back !== undefined) return true;
  const link = linkOf(step);
  return link !== undefined && !INSIGHTS_LINK.test(link);
};

const tapsSections = (step) => step.tapOn?.id === 'tab-sections';

/** Whether a command list taps the Sections tab while the insights screen is up. */
function tapsStripOnInsights(steps, state = { onInsights: false }) {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (opensInsights(step)) state.onInsights = true;
    else if (leavesInsights(step)) state.onInsights = false;
    if (state.onInsights && tapsSections(step)) return true;
    if (
      Array.isArray(step.runFlow?.commands) &&
      tapsStripOnInsights(step.runFlow.commands, state)
    ) {
      return true;
    }
  }
  return false;
}

const failures = [];
for (const [file, bytes] of flows) {
  const commands = loadAll(bytes.toString('utf8')).find(Array.isArray) ?? [];
  if (tapsStripOnInsights(commands)) failures.push(file);
}

if (failures.length > 0) {
  console.error(
    `lint-maestro-strip-tap: ${failures.length} flow(s) tap the insights Sections tab after the screen opens:`
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    'Open the tab with `runFlow: file: helpers/navigate-to-sections.yaml`, which follows veloq://insights?tab=sections.'
  );
  process.exit(1);
}

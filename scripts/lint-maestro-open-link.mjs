#!/usr/bin/env node
// Every deep link a Maestro flow follows goes through helpers/open-link.yaml.
//
// iOS raises its "Open in <app>?" sheet some time after the link is followed,
// and on a fresh hosted simulator that is later than a one-shot conditional tap
// waits. The conditional is then false, nothing taps the sheet afterwards, and
// the screen under it is asserted behind the sheet. The helper polls for the
// target screen and taps the sheet whenever it is up, so the sheet has one
// owner and a bare `openLink:` is the three-step shape that loses the race.

import { resolve } from 'node:path';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const HELPER = '.maestro/helpers/open-link.yaml';
const BARE = /^\s*(?:-\s+)?openLink\s*:/;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const flows = indexedSources(root, ['.maestro/*.yaml']);
refuseEmptyListing(flows, 'lint-maestro-open-link');

const failures = [];
for (const [file, bytes] of flows) {
  if (file === HELPER) continue;
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((line, index) => {
      if (BARE.test(line)) failures.push(`${file}:${index + 1}: ${line.trim()}`);
    });
}

if (failures.length > 0) {
  console.error(`lint-maestro-open-link: ${failures.length} bare openLink outside ${HELPER}:`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "Use `runFlow: file: helpers/open-link.yaml` with env LINK and TARGET, the id of the link's screen."
  );
  process.exit(1);
}

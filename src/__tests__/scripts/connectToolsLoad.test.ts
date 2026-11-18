/**
 * Scenario: the screenshot tool and the mock-up tool run under tsx, outside
 * Jest, and load the demo library the browser harness serves. A module that
 * library imports and that reaches React Native cannot be transformed there.
 *
 * Expected behaviour: both tools load under tsx and exit cleanly.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

it('loads the screenshot and mock-up tools under tsx', () => {
  const run = spawnSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    ['-e', "require('./scripts/connect-screenshots'); require('./scripts/connect-mockups')"],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const failure = run.stderr.split('\n').find((line) => /Error/.test(line)) ?? '';
  expect({ status: run.status, failure }).toEqual({ status: 0, failure: '' });
}, 60_000);

/**
 * Scenario: a screen asks Rust for a power curve, a body or a set of time
 * streams. The request is refused for one of two opposite reasons: the same
 * key is already being fetched, so the next ask succeeds the moment it lands,
 * or there is no credential, so no amount of asking produces one. Both used to
 * reach TypeScript as `false`.
 *
 * Expected behaviour: the delegates carry the verdict, and only the one worth
 * retrying reads as retryable.
 */

import { StartOutcome, isRetryableStart, hasStarted } from 'veloqrs';
// The module under test is this tree's, not whatever `node_modules/veloqrs`
// currently points at, which is one symlink shared by every worktree.
import {
  syncPowerCurve,
  syncTimeStreams,
  syncActivityDetail,
} from '../../../modules/veloqrs/src/delegates/sync';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

function host(ready: boolean, answer: unknown): DelegateHost {
  return {
    ready,
    timed: (_label: string, run: () => unknown) => run(),
    notify: jest.fn(),
    engine: {
      sync: () => ({
        syncPowerCurve: () => answer,
        syncTimeStreams: () => answer,
        syncActivityDetail: () => answer,
      }),
    },
  } as unknown as DelegateHost;
}

test('a busy key is retryable and a missing credential is not', () => {
  const busy = syncPowerCurve(host(true, StartOutcome.Busy), 'Ride', 90);
  const unconfigured = syncPowerCurve(host(true, StartOutcome.NotConfigured), 'Ride', 90);

  expect(busy).toBe(StartOutcome.Busy);
  expect(isRetryableStart(busy)).toBe(true);
  expect(unconfigured).toBe(StartOutcome.NotConfigured);
  expect(isRetryableStart(unconfigured)).toBe(false);
});

test('an engine that is not open yet says so rather than refusing', () => {
  const outcome = syncActivityDetail(host(false, StartOutcome.Started), 'a1');

  expect(outcome).toBe(StartOutcome.NotReady);
  expect(isRetryableStart(outcome)).toBe(true);
});

test('an empty list of time streams is no work, not a refusal to do it', () => {
  const outcome = syncTimeStreams(host(true, StartOutcome.Started), []);

  expect(outcome).toBe(StartOutcome.NotOwed);
  expect(isRetryableStart(outcome)).toBe(false);
  expect(hasStarted(outcome)).toBe(false);
});

test('a started fetch reads as started', () => {
  expect(hasStarted(syncTimeStreams(host(true, StartOutcome.Started), ['a1']))).toBe(true);
});

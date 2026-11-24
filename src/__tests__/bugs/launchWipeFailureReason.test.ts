/**
 * Scenario: the launch wipe rejects after the athlete signed in as someone else,
 * so the library still holds the previous athlete's rows and is open.
 *
 * Expected behaviour: the read state is `failed` while the init failure is set,
 * even with an open handle, and the failure names the wipe rather than saying
 * the library could not be opened and is untouched.
 */
import { engineReadState } from '@/shared/native/useEngineSubscription';
import { engineInitReasonKey, engineRecoveryActions } from '@/shared/app/engineInitReason';

jest.mock('veloqrs', () => require('./../__shared__/veloqrsStub').withOverrides());

describe('launch wipe failure', () => {
  it('reads as failed with an open handle while the init failure is set', () => {
    expect(engineReadState(true, true)).toBe('failed');
  });

  it('keeps the other states', () => {
    expect(engineReadState(true, false)).toBe('ready');
    expect(engineReadState(false, true)).toBe('failed');
    expect(engineReadState(false, false)).toBe('closed');
  });

  it('gives a failed wipe its own line and a retry', () => {
    expect(engineInitReasonKey('wipeFailed')).toBe('engine.initReason.wipeFailed');
    const retry = jest.fn();
    const actions = engineRecoveryActions('wipeFailed', ((k: string) => k) as never, retry);
    expect(actions.map((a) => a.testID)).toEqual(['engine-retry-button']);
  });
});

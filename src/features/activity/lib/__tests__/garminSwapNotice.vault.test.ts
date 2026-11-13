/**
 * Scenario: the engine answers a swap or an undo with an outcome.
 *
 * Expected behaviour: each outcome says what happened to intervals.icu's file in
 * its own words, only a swap that landed or was restored offers a fresh read of
 * the activity, and a swap that wrote a different file keeps Undo in reach.
 */

import { SwapOutcome } from 'veloqrs';

import { garminSwapNotice } from '../garminSwapNotice';

jest.mock('veloqrs', () => require('../../../../__tests__/__shared__/veloqrsStub'));

describe('garminSwapNotice', () => {
  it('names a swap that landed and one that was undone', () => {
    expect(garminSwapNotice(SwapOutcome.Replaced, 'swap')).toMatchObject({
      key: 'activity.garminSwap.replaced',
      tone: 'success',
      rereads: true,
    });
    expect(garminSwapNotice(SwapOutcome.Restored, 'undo')).toMatchObject({
      key: 'activity.garminSwap.restored',
      tone: 'success',
      rereads: true,
    });
  });

  it('says a refusal changed nothing', () => {
    expect(garminSwapNotice(SwapOutcome.Refused, 'swap')).toEqual({
      key: 'activity.garminSwap.refused',
      tone: 'error',
      rereads: false,
    });
  });

  it('reports a different file than the one sent, and re-reads because the file did change', () => {
    expect(garminSwapNotice(SwapOutcome.Mismatch, 'swap')).toEqual({
      key: 'activity.garminSwap.mismatch',
      tone: 'error',
      rereads: true,
    });
  });

  it('keeps permission, sign-in and Garmin failures apart', () => {
    const keys = [
      SwapOutcome.PermissionBlocked,
      SwapOutcome.AuthExpired,
      SwapOutcome.GarminUnavailable,
      SwapOutcome.Failed,
      SwapOutcome.NotEligible,
      SwapOutcome.Unchanged,
    ].map((outcome) => garminSwapNotice(outcome, 'swap').key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^activity\.garminSwap\./);
  });

  it('says a failed undo is an undo failure', () => {
    expect(garminSwapNotice(SwapOutcome.Failed, 'undo').key).toBe('activity.garminSwap.undoFailed');
  });
});

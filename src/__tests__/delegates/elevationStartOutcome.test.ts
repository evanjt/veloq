/**
 * Scenario: the backfill's start answered `false` whether the queue was empty,
 * a pass held the slot, the device was offline or no credential had arrived.
 *
 * Expected behaviour: the delegate passes Rust's verdict through untouched,
 * and supplies the two verdicts Rust cannot give: the engine not being open,
 * and the FFI call itself throwing.
 */

import { startElevationBackfill } from '../../../modules/veloqrs/src/delegates/elevation';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import { FfiStartOutcome } from '../../../modules/veloqrs/src/generated/veloqrs';

const mockStart = jest.fn();

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  startElevationBackfill: () => mockStart(),
}));

function host(ready: boolean): DelegateHost {
  return {
    ready,
    timed: <T>(_name: string, run: () => T) => run(),
  } as unknown as DelegateHost;
}

describe('the backfill start delegate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers NotReady before the engine is open, without calling Rust', () => {
    expect(startElevationBackfill(host(false))).toBe(FfiStartOutcome.NotReady);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('passes every verdict through untouched', () => {
    for (const outcome of [
      FfiStartOutcome.Started,
      FfiStartOutcome.Busy,
      FfiStartOutcome.Held,
      FfiStartOutcome.NotConfigured,
      FfiStartOutcome.NotOwed,
      FfiStartOutcome.Offline,
    ]) {
      mockStart.mockReturnValue(outcome);
      expect(startElevationBackfill(host(true))).toBe(outcome);
    }
  });

  it('answers Failed when the call itself throws', () => {
    mockStart.mockImplementation(() => {
      throw new Error('engine gone');
    });
    expect(startElevationBackfill(host(true))).toBe(FfiStartOutcome.Failed);
  });
});

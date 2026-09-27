/**
 * Scenario: the cutover diff used to cross as a JSON string the change card
 * parsed and cast blind, so a field renamed in Rust reached the card as
 * `undefined`. It crosses as a record now, and the engine's own tests
 * cover the parse of the settings row it is read from.
 *
 * Expected behaviour: what is left on this side is the difference between the
 * record and the shape the card reads, and it is silent when wrong: an absent
 * reset arrives as `undefined` where the card reads `null`.
 */

import { getCutoverDiff } from '../../../modules/veloqrs/src/delegates/cutover';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import type { FfiCutoverDiff } from '../../../modules/veloqrs/src/generated/veloqrs';

const mockDiff = jest.fn();

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  getCutoverDiff: () => mockDiff(),
}));

function host(ready: boolean): DelegateHost {
  return {
    ready,
    timed: <T>(_name: string, run: () => T) => run(),
  } as unknown as DelegateHost;
}

const SETTINGS = {
  proximityThreshold: 25,
  minSectionLength: 500,
  maxSectionLength: 20000,
  minActivities: 3,
  divergenceThreshold: 0.35,
};

function record(overrides: Partial<FfiCutoverDiff> = {}): FfiCutoverDiff {
  return {
    token: 'detector-v2',
    counts: { current: 12, proposed: 14, unchanged: 9, changed: 3, new: 2, gone: 0 },
    settingsReset: { previous: SETTINGS, current: SETTINGS },
    ...overrides,
  };
}

describe('the cutover diff delegate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('gives the card the counts, with new spelled as the card spells it', () => {
    mockDiff.mockReturnValue(record());

    const diff = getCutoverDiff(host(true));

    expect(diff?.counts).toEqual({
      current: 12,
      proposed: 14,
      unchanged: 9,
      changed: 3,
      new: 2,
      gone: 0,
    });
    expect(diff?.token).toBe('detector-v2');
    expect(diff?.settingsReset?.previous.minActivities).toBe(3);
  });

  it('reads an absent reset as null, which is what the card checks', () => {
    const noReset = record();
    delete noReset.settingsReset;
    mockDiff.mockReturnValue(noReset);

    expect(getCutoverDiff(host(true))?.settingsReset).toBeNull();
  });

  it('answers null with no stored diff, and before the engine is open', () => {
    mockDiff.mockReturnValue(undefined);
    expect(getCutoverDiff(host(true))).toBeNull();

    mockDiff.mockClear();
    expect(getCutoverDiff(host(false))).toBeNull();
    expect(mockDiff).not.toHaveBeenCalled();
  });

  it('answers null rather than throwing when the call itself throws', () => {
    mockDiff.mockImplementation(() => {
      throw new Error('engine gone');
    });

    expect(getCutoverDiff(host(true))).toBeNull();
  });
});

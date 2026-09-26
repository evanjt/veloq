/**
 * Scenario: the fitness screen sourced the running threshold pace from the
 * downloaded pace curve alone, so an athlete with no cached curve lost the
 * figure and, with no LTHR either, the whole Running block.
 *
 * Expected behaviour: the persisted pace snapshot the app already writes
 * stands in for the curve, and a speed that is not a speed counts as absent.
 */

import { resolveThresholdPace } from '@/features/fitness/lib/thresholdPace';

describe('the running threshold pace', () => {
  it('takes the curve while it is loaded', () => {
    expect(resolveThresholdPace(4.2, 3.9)).toBe(4.2);
  });

  it('falls back to the stored snapshot when the curve is absent', () => {
    expect(resolveThresholdPace(undefined, 3.9)).toBe(3.9);
    expect(resolveThresholdPace(null, 3.9)).toBe(3.9);
  });

  it('answers null when neither is there', () => {
    expect(resolveThresholdPace(undefined, undefined)).toBeNull();
    expect(resolveThresholdPace(null, null)).toBeNull();
  });

  it('reads a zero or negative critical speed as absent', () => {
    expect(resolveThresholdPace(0, 3.9)).toBe(3.9);
    expect(resolveThresholdPace(-1, 3.9)).toBe(3.9);
    expect(resolveThresholdPace(0, 0)).toBeNull();
  });

  it('reads a non-finite critical speed as absent', () => {
    expect(resolveThresholdPace(NaN, 3.9)).toBe(3.9);
    expect(resolveThresholdPace(Infinity, NaN)).toBeNull();
  });
});

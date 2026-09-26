/**
 * Scenario: R6's flow corridor reads `meta.signalDelta`, a z-score of the
 * reading against its own baseline, and one emit site of fifteen computed one.
 *
 * Expected behaviour: one helper answers the z-score wherever a series carries
 * a spread, and says it has none wherever it does not. An absence is a claim,
 * so an invented number is worse than no number.
 */

import { signalDeltaFrom } from '@/features/insights/lib/signalDelta';

describe('the signal delta', () => {
  it('is the distance from the baseline in standard deviations', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] has mean 5 and stddev 2.
    const samples = [2, 4, 4, 4, 5, 5, 7, 9];

    expect(signalDeltaFrom(9, 5, samples)).toBeCloseTo(2);
    expect(signalDeltaFrom(4, 5, samples)).toBeCloseTo(0.5);
  });

  it('is unsigned, so a fall and a rise of the same size read alike', () => {
    const samples = [2, 4, 4, 4, 5, 5, 7, 9];

    expect(signalDeltaFrom(1, 5, samples)).toBeCloseTo(signalDeltaFrom(9, 5, samples) as number);
  });

  it('has none from a series too short to hold a spread', () => {
    expect(signalDeltaFrom(9, 5, [5])).toBeUndefined();
    expect(signalDeltaFrom(9, 5, [])).toBeUndefined();
  });

  it('has none from a flat series, where every reading is the baseline', () => {
    expect(signalDeltaFrom(6, 5, [5, 5, 5, 5])).toBeUndefined();
  });

  it('has none when the reading or the baseline is not a number', () => {
    const samples = [2, 4, 4, 4, 5, 5, 7, 9];

    expect(signalDeltaFrom(NaN, 5, samples)).toBeUndefined();
    expect(signalDeltaFrom(9, Infinity, samples)).toBeUndefined();
  });

  it('has none when the series carries a value that is not a number', () => {
    expect(signalDeltaFrom(9, 5, [2, NaN, 7, 9])).toBeUndefined();
  });
});

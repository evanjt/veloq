/**
 * Scenario: grade and ahead-or-behind share one seven-step ramp on the map line,
 * banded by fixed thresholds, so a colour always means one band whatever line
 * it is drawn on.
 */

import { DIVERGING_BANDS, divergingStep } from '@/features/maps/lib/divergingStep';

describe('divergingStep', () => {
  it('bands a grade by its fixed thresholds', () => {
    expect(divergingStep(-2.5, 'grade')).toBe('cool-1');
    expect(divergingStep(-1.9, 'grade')).toBe('mid');
    expect(divergingStep(0, 'grade')).toBe('mid');
    expect(divergingStep(2, 'grade')).toBe('mid');
    expect(divergingStep(-2, 'grade')).toBe('mid');
    expect(divergingStep(5, 'grade')).toBe('warm-1');
    expect(divergingStep(-5, 'grade')).toBe('cool-1');
    expect(divergingStep(5.1, 'grade')).toBe('warm-2');
    expect(divergingStep(-10, 'grade')).toBe('cool-2');
    expect(divergingStep(10.5, 'grade')).toBe('warm-3');
    expect(divergingStep(-30, 'grade')).toBe('cool-3');
  });

  it('bands a lap slower than the reference warm and faster cool', () => {
    expect(divergingStep(0.9, 'pace')).toBe('mid');
    expect(divergingStep(1, 'pace')).toBe('mid');
    expect(divergingStep(1.1, 'pace')).toBe('warm-1');
    expect(divergingStep(-1.1, 'pace')).toBe('cool-1');
    expect(divergingStep(3, 'pace')).toBe('warm-1');
    expect(divergingStep(-4, 'pace')).toBe('cool-2');
    expect(divergingStep(6, 'pace')).toBe('warm-2');
    expect(divergingStep(6.5, 'pace')).toBe('warm-3');
    expect(divergingStep(-12, 'pace')).toBe('cool-3');
  });

  it('gives no step to a value that is not a number', () => {
    expect(divergingStep(NaN, 'grade')).toBeNull();
    expect(divergingStep(Infinity, 'pace')).toBeNull();
  });

  it.each(['grade', 'pace'] as const)(
    'lists seven %s bands end to end, each holding the values it bands',
    (kind) => {
      const bands = DIVERGING_BANDS[kind];
      expect(bands.map((band) => band.step)).toEqual([
        'cool-3',
        'cool-2',
        'cool-1',
        'mid',
        'warm-1',
        'warm-2',
        'warm-3',
      ]);
      expect(bands[0]!.from).toBe(-Infinity);
      expect(bands[6]!.to).toBe(Infinity);
      bands.slice(1).forEach((band, i) => expect(band.from).toBe(bands[i]!.to));
      for (const band of bands) {
        const inside = Number.isFinite(band.from)
          ? Number.isFinite(band.to)
            ? (band.from + band.to) / 2
            : band.from + 1
          : band.to - 1;
        expect(divergingStep(inside, kind)).toBe(band.step);
      }
    }
  );
});

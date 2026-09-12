/**
 * Scenario: a trim handle is dragged across a long recording, and every frame
 * asks for the elevation gain and the averages of the window under it.
 *
 * Expected behaviour: the constant-time answer is the same one a full walk of
 * the slice gives, dropouts and all.
 */
import {
  buildStreamPrefixes,
  windowAverage,
  windowGain,
} from '@/features/recording/lib/streamPrefixes';
import { elevationGain } from '@/shared/math';

const walkAverage = (values: number[]): number | null => {
  const kept = values.filter((v) => v > 0);
  return kept.length > 0 ? kept.reduce((sum, v) => sum + v, 0) / kept.length : null;
};

const streams = (altitude: number[], heartrate?: number[], power?: number[]) => ({
  altitude,
  heartrate: heartrate ?? altitude.map(() => 0),
  power: power ?? altitude.map(() => 0),
});

describe('windowGain', () => {
  const cases: [string, number[]][] = [
    ['a climb', [100, 110, 120, 130]],
    ['a descent', [130, 120, 110, 100]],
    ['a rolling profile', [100, 105, 101, 108, 104, 112]],
    ['a flat ride', [100, 100, 100, 100]],
    ['one point', [100]],
    ['nothing', []],
  ];

  it.each(cases)('matches a full walk over every window of %s', (_name, altitude) => {
    const prefixes = buildStreamPrefixes(streams(altitude));
    for (let start = 0; start < altitude.length; start += 1) {
      for (let end = start; end < altitude.length; end += 1) {
        expect(windowGain(prefixes, start, end)).toBeCloseTo(
          elevationGain(altitude.slice(start, end + 1)),
          9
        );
      }
    }
  });

  it('matches a full walk when the window opens on a dropout', () => {
    // NaN is what a lost altitude fix reads as, and the walk skips it.
    const altitude = [100, NaN, 140, 141, NaN, 150];
    const prefixes = buildStreamPrefixes(streams(altitude));

    for (let start = 0; start < altitude.length; start += 1) {
      for (let end = start; end < altitude.length; end += 1) {
        expect(windowGain(prefixes, start, end)).toBeCloseTo(
          elevationGain(altitude.slice(start, end + 1)),
          9
        );
      }
    }
  });

  it('does not credit a window with a climb that happened before it', () => {
    const prefixes = buildStreamPrefixes(streams([100, 200, 201]));

    expect(windowGain(prefixes, 1, 2)).toBe(1);
  });

  it('answers nothing for a window with no points', () => {
    const prefixes = buildStreamPrefixes(streams([]));

    expect(windowGain(prefixes, 0, 5)).toBe(0);
  });
});

describe('windowAverage', () => {
  it('matches a filtered walk over every window', () => {
    const heartrate = [0, 140, 0, 152, 160, 0, 148];
    const prefixes = buildStreamPrefixes(
      streams(
        heartrate.map(() => 100),
        heartrate
      )
    );

    for (let start = 0; start < heartrate.length; start += 1) {
      for (let end = start; end < heartrate.length; end += 1) {
        expect(windowAverage(prefixes.hrSum, prefixes.hrCount, prefixes, start, end)).toEqual(
          walkAverage(heartrate.slice(start, end + 1))
        );
      }
    }
  });

  it('answers null for a window that carries no reading at all', () => {
    const prefixes = buildStreamPrefixes(streams([100, 100, 100], [0, 0, 0]));

    expect(windowAverage(prefixes.hrSum, prefixes.hrCount, prefixes, 0, 2)).toBeNull();
  });

  it('clamps a window that runs past the end of the recording', () => {
    const prefixes = buildStreamPrefixes(streams([100, 100], [150, 150]));

    expect(windowAverage(prefixes.hrSum, prefixes.hrCount, prefixes, 0, 99)).toBe(150);
  });
});

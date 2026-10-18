/**
 * Scenario: the section line is banded by how far ahead or behind the shown
 * attempt is over each stretch, as a percentage of the reference's time there,
 * on the scale grade shares.
 * Expected behaviour: the same percentage is the same band on any attempt, and a
 * stretch the attempt did not cover is a no-data range drawn by its own layer.
 */

import { deltaLineBands, lineBandExpression, noDataRanges, type LineBand } from '../deltaLineColor';
import { colorWithOpacity, mapPalette } from '@/theme';

const palette = mapPalette('light');
const stepsOf = (bands: LineBand[] | null) => (bands ?? []).map((band) => band.step);
const startsOf = (bands: LineBand[] | null) => (bands ?? []).map((band) => band.start);

describe('deltaLineBands', () => {
  it('bands each stretch by its own percentage, not by the attempt', () => {
    const close = deltaLineBands([0.5, 2, -2], 100, 300, 'forward');
    const wild = deltaLineBands([0.5, 2, -2, 40], 100, 400, 'forward');
    expect(stepsOf(close)).toEqual(['mid', 'warm-1', 'cool-1']);
    expect(stepsOf(wild).slice(0, 3)).toEqual(stepsOf(close));
    expect(stepsOf(wild)[3]).toBe('warm-3');
  });

  it('starts each band where its stretch begins on the line', () => {
    const bands = deltaLineBands([5, 5, -5, 0], 100, 350, 'forward')!;
    expect(bands.map((band) => [band.start, band.end, band.step])).toEqual([
      [0, 200 / 350, 'warm-2'],
      [200 / 350, 300 / 350, 'cool-2'],
      [300 / 350, 1, 'mid'],
    ]);
  });

  it('gives a stretch the attempt did not cover no step', () => {
    expect(stepsOf(deltaLineBands([2, NaN, -2], 100, 300, 'forward'))).toEqual([
      'warm-1',
      null,
      'cool-1',
    ]);
  });

  it('puts the first stretch of a reverse attempt at the far end of the line', () => {
    const reverse = deltaLineBands([7, 0, 0], 100, 250, 'reverse')!;
    expect(stepsOf(reverse)).toEqual(['mid', 'warm-3']);
    expect(startsOf(reverse)).toEqual([0, 150 / 250]);
    expect(reverse[1]!.end).toBe(1);
  });

  it('draws nothing without stretches or a length', () => {
    expect(deltaLineBands([], 100, 1000, 'forward')).toBeNull();
    expect(deltaLineBands([1], 100, 0, 'forward')).toBeNull();
    expect(deltaLineBands([1], 0, 100, 'forward')).toBeNull();
  });
});

describe('noDataRanges', () => {
  it('lists each run of stretches with no step, as fractions of the line', () => {
    const bands = deltaLineBands([NaN, NaN, 2, NaN], 100, 400, 'forward');
    expect(noDataRanges(bands)).toEqual([
      [0, 0.5],
      [0.75, 1],
    ]);
  });

  it('is empty for a fully covered attempt and for no attempt', () => {
    expect(noDataRanges(deltaLineBands([1, 2], 100, 200, 'forward'))).toEqual([]);
    expect(noDataRanges(null)).toEqual([]);
  });
});

describe('lineBandExpression', () => {
  it('steps over line-progress in the base map ramp, clear where there is no data', () => {
    const bands = deltaLineBands([-7, NaN, 2], 100, 300, 'forward')!;
    expect(lineBandExpression(bands, palette)).toEqual([
      'step',
      ['line-progress'],
      palette.div['cool-3'],
      1 / 3,
      colorWithOpacity(palette.muted, 0),
      2 / 3,
      palette.div['warm-1'],
    ]);
  });

  it('reads the ramp of the base it is drawn over', () => {
    const bands = deltaLineBands([4], 100, 100, 'forward')!;
    const dark = mapPalette('dark');
    expect(lineBandExpression(bands, dark)).toEqual([
      'step',
      ['line-progress'],
      dark.div['warm-2'],
    ]);
  });
});

/**
 * Scenario: the summary card and the home widget draw the same five metrics,
 * and every threshold was written out twice with nothing asserting the two
 * agreed. They matched until the card's wellness baselines were fixed and the
 * widget's were not.
 *
 * Expected behaviour: one primitive, one threshold table, and a test that
 * fails the day a threshold is changed on one surface and not the other.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TREND_DEADBAND, trendArrow, trendDirection, trendOfMetric } from '@/shared/format/trend';

describe('trendDirection', () => {
  it('reads a rise above the deadband as up', () => {
    expect(trendDirection(12, 10, 1)).toBe('up');
  });

  it('reads a fall below the deadband as down', () => {
    expect(trendDirection(8, 10, 1)).toBe('down');
  });

  it('reads a move inside the deadband as flat', () => {
    expect(trendDirection(10.4, 10, 1)).toBe('flat');
  });

  it('reads a move exactly on the deadband as a move', () => {
    // The deadband is what a move has to clear, not reach: every surface has
    // read it that way and this keeps them all saying the same thing.
    expect(trendDirection(11, 10, 1)).toBe('up');
  });

  it('reads a missing value on either side as flat', () => {
    expect(trendDirection(null, 10, 1)).toBe('flat');
    expect(trendDirection(10, undefined, 1)).toBe('flat');
  });

  it('reads a value that is not a number as flat', () => {
    expect(trendDirection(Number.NaN, 10, 1)).toBe('flat');
    expect(trendDirection(10, Number.POSITIVE_INFINITY, 1)).toBe('flat');
  });

  it('takes the metric its own threshold', () => {
    // Weight moves in tenths, so 0.4 kg is a move; FTP does not move on 1 W.
    expect(trendOfMetric('weight', 70.4, 70)).toBe('up');
    expect(trendOfMetric('ftp', 251, 250)).toBe('flat');
    expect(trendOfMetric('ftp', 253, 250)).toBe('up');
  });
});

describe('trendArrow', () => {
  it('draws the arrow the card and the wellness stats share', () => {
    expect(trendArrow('up')).toBe('↑');
    expect(trendArrow('down')).toBe('↓');
    expect(trendArrow('flat')).toBe('');
  });
});

describe('the two surfaces that draw the same metrics', () => {
  const ROOT = join(__dirname, '../../..');
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  const SURFACES = [
    'src/features/home/lib/widgetSnapshot.ts',
    'src/features/home/hooks/useSummaryCardData.ts',
    'src/features/wellness/lib/wellnessStats.ts',
  ];

  it.each(SURFACES)('takes its thresholds from the shared table: %s', (path) => {
    expect(read(path)).toMatch(/from '@\/shared\/format\/trend'/);
  });

  it.each(SURFACES)('writes no threshold of its own: %s', (path) => {
    // A bare number handed to a trend call is the shape that drifted: the
    // widget and the card each carried their own copy of all five.
    expect(read(path)).not.toMatch(/trend(Of|Direction|OfMetric)?\([^)]*,\s*0?\.\d+\)/);
  });

  it('gives every metric both surfaces draw a threshold', () => {
    for (const metric of ['weekHours', 'weekCount', 'ftp', 'thresholdPace', 'css'] as const) {
      expect(TREND_DEADBAND[metric]).toBeGreaterThan(0);
    }
  });
});

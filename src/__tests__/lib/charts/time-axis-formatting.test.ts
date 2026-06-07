/**
 * Tests for time-axis helpers used by date-based charts.
 */

import {
  computeTimeAxisLabels,
  axisLabelsNeedDay,
  formatAxisDate,
} from '@/features/stats/lib/timeAxis';

function dp(iso: string): { date: Date } {
  return { date: new Date(iso) };
}

describe('computeTimeAxisLabels', () => {
  it('returns empty array for empty input', () => {
    expect(computeTimeAxisLabels([])).toEqual([]);
  });

  it('returns empty array for a single point (no axis needed)', () => {
    expect(computeTimeAxisLabels([dp('2024-01-01')])).toEqual([]);
  });

  it('returns [first, mid, last] for two points with midpoint at average timestamp', () => {
    const points = [dp('2024-01-01'), dp('2024-01-31')];
    const labels = computeTimeAxisLabels(points);
    expect(labels).toHaveLength(3);
    expect(labels[0].getTime()).toBe(new Date('2024-01-01').getTime());
    expect(labels[2].getTime()).toBe(new Date('2024-01-31').getTime());
    // Mid should be the average of first + last
    const expectedMid = (new Date('2024-01-01').getTime() + new Date('2024-01-31').getTime()) / 2;
    expect(labels[1].getTime()).toBe(expectedMid);
  });

  it('uses first and last points even with many points in between', () => {
    const points = [
      dp('2024-01-01'),
      dp('2024-03-15'),
      dp('2024-06-30'),
      dp('2024-09-15'),
      dp('2024-12-31'),
    ];
    const labels = computeTimeAxisLabels(points);
    expect(labels[0].getTime()).toBe(new Date('2024-01-01').getTime());
    expect(labels[2].getTime()).toBe(new Date('2024-12-31').getTime());
  });
});

describe('axisLabelsNeedDay', () => {
  it('returns false when labels are empty or short', () => {
    expect(axisLabelsNeedDay([])).toBe(false);
    expect(axisLabelsNeedDay([new Date('2024-01-01')])).toBe(false);
  });

  it('needs day precision only when adjacent labels share month/year', () => {
    const cases: { label: string; labels: Date[]; expected: boolean }[] = [
      {
        label: 'all three in different months',
        labels: [new Date('2024-01-15'), new Date('2024-06-15'), new Date('2024-12-15')],
        expected: false,
      },
      {
        label: 'first and middle share month/year',
        labels: [new Date('2024-06-01'), new Date('2024-06-15'), new Date('2024-12-15')],
        expected: true,
      },
      {
        label: 'middle and last share month/year',
        labels: [new Date('2024-01-01'), new Date('2024-06-15'), new Date('2024-06-30')],
        expected: true,
      },
      {
        label: 'same month in different years',
        labels: [new Date('2023-06-15'), new Date('2024-06-15'), new Date('2025-06-15')],
        expected: false,
      },
    ];
    for (const { labels, expected } of cases) {
      expect(axisLabelsNeedDay(labels)).toBe(expected);
    }
  });
});

describe('formatAxisDate', () => {
  it('formats date as "Mmm \'YY" when includeDay is false', () => {
    const label = formatAxisDate(new Date('2024-01-15'), false);
    expect(label).toMatch(/Jan '24/);
    expect(label).not.toMatch(/15/);
  });

  it('formats date as "Mmm DD \'YY" when includeDay is true', () => {
    const label = formatAxisDate(new Date('2024-01-15'), true);
    expect(label).toMatch(/Jan 15 '24/);
  });

  it('handles year boundaries correctly', () => {
    const dec = formatAxisDate(new Date('2023-12-31'), false);
    const jan = formatAxisDate(new Date('2024-01-01'), false);
    expect(dec).toContain("'23");
    expect(jan).toContain("'24");
  });
});

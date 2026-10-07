/**
 * Tests for time-axis helpers used by date-based charts.
 */

import { computeTimeAxisLabels, axisLabelsNeedDay } from '@/features/stats/lib/timeAxis';

function dp(iso: string): { date: Date } {
  return { date: new Date(iso) };
}

describe('computeTimeAxisLabels', () => {
  it('returns empty array for empty input', () => {
    expect(computeTimeAxisLabels([])).toEqual([]);
  });

  it('returns empty array for a single point (no axis needed)', () => {
    expect(computeTimeAxisLabels([dp('2024-01-01T12:00:00')])).toEqual([]);
  });

  it('returns [first, mid, last] for two points with midpoint at average timestamp', () => {
    const points = [dp('2024-01-01T12:00:00'), dp('2024-01-31T12:00:00')];
    const labels = computeTimeAxisLabels(points);
    expect(labels).toHaveLength(3);
    expect(labels[0].getTime()).toBe(new Date('2024-01-01T12:00:00').getTime());
    expect(labels[2].getTime()).toBe(new Date('2024-01-31T12:00:00').getTime());
    // Mid should be the average of first + last
    const expectedMid =
      (new Date('2024-01-01T12:00:00').getTime() + new Date('2024-01-31T12:00:00').getTime()) / 2;
    expect(labels[1].getTime()).toBe(expectedMid);
  });

  it('uses first and last points even with many points in between', () => {
    const points = [
      dp('2024-01-01T12:00:00'),
      dp('2024-03-15T12:00:00'),
      dp('2024-06-30T12:00:00'),
      dp('2024-09-15T12:00:00'),
      dp('2024-12-31T12:00:00'),
    ];
    const labels = computeTimeAxisLabels(points);
    expect(labels[0].getTime()).toBe(new Date('2024-01-01T12:00:00').getTime());
    expect(labels[2].getTime()).toBe(new Date('2024-12-31T12:00:00').getTime());
  });
});

describe('axisLabelsNeedDay', () => {
  it('returns false when labels are empty or short', () => {
    expect(axisLabelsNeedDay([])).toBe(false);
    expect(axisLabelsNeedDay([new Date('2024-01-01T12:00:00')])).toBe(false);
  });

  it('needs day precision only when adjacent labels share month/year', () => {
    const cases: { label: string; labels: Date[]; expected: boolean }[] = [
      {
        label: 'all three in different months',
        labels: [
          new Date('2024-01-15T12:00:00'),
          new Date('2024-06-15T12:00:00'),
          new Date('2024-12-15T12:00:00'),
        ],
        expected: false,
      },
      {
        label: 'first and middle share month/year',
        labels: [
          new Date('2024-06-01T12:00:00'),
          new Date('2024-06-15T12:00:00'),
          new Date('2024-12-15T12:00:00'),
        ],
        expected: true,
      },
      {
        label: 'middle and last share month/year',
        labels: [
          new Date('2024-01-01T12:00:00'),
          new Date('2024-06-15T12:00:00'),
          new Date('2024-06-30T12:00:00'),
        ],
        expected: true,
      },
      {
        label: 'same month in different years',
        labels: [
          new Date('2023-06-15T12:00:00'),
          new Date('2024-06-15T12:00:00'),
          new Date('2025-06-15T12:00:00'),
        ],
        expected: false,
      },
    ];
    for (const { labels, expected } of cases) {
      expect(axisLabelsNeedDay(labels)).toBe(expected);
    }
  });
});

/**
 * Tests for time-axis helpers used by date-based charts.
 */

import { computeTimeAxisLabels, axisLabelsNeedDay, formatAxisDate } from '@/lib/charts/timeAxis';

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

  it('returns false when all three labels are in different months', () => {
    const labels = [new Date('2024-01-15'), new Date('2024-06-15'), new Date('2024-12-15')];
    expect(axisLabelsNeedDay(labels)).toBe(false);
  });

  it('returns true when first and middle labels share month/year', () => {
    const labels = [new Date('2024-06-01'), new Date('2024-06-15'), new Date('2024-12-15')];
    expect(axisLabelsNeedDay(labels)).toBe(true);
  });

  it('returns true when middle and last labels share month/year', () => {
    const labels = [new Date('2024-01-01'), new Date('2024-06-15'), new Date('2024-06-30')];
    expect(axisLabelsNeedDay(labels)).toBe(true);
  });

  it('distinguishes same month in different years', () => {
    const labels = [new Date('2023-06-15'), new Date('2024-06-15'), new Date('2025-06-15')];
    expect(axisLabelsNeedDay(labels)).toBe(false);
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

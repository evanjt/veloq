/**
 * Tests for gap-compression chart helpers.
 *
 * These are pure math utilities with no React/Victory dependencies, so
 * we test them directly without any mocking.
 */

import {
  buildGapCompression,
  calculateChartWidth,
  DEFAULT_COMPRESSED_GAP_DAYS,
  DEFAULT_GAP_THRESHOLD_DAYS,
  detectGaps,
} from '@/lib/charts/gapCompression';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LAYOUT = {
  baseChartWidth: 360,
  chartPaddingLeft: 40,
  chartPaddingRight: 20,
};

function dp(days: number): { date: Date } {
  // Anchor to a stable epoch so tests don't depend on "today"
  const base = new Date('2025-01-01T00:00:00Z').getTime();
  return { date: new Date(base + days * MS_PER_DAY) };
}

describe('detectGaps', () => {
  it('returns empty array for fewer than two points', () => {
    expect(detectGaps([])).toEqual([]);
    expect(detectGaps([dp(0)])).toEqual([]);
  });

  it('returns no gaps when points are close together', () => {
    const points = [dp(0), dp(1), dp(5), dp(13)];
    expect(detectGaps(points, DEFAULT_GAP_THRESHOLD_DAYS)).toEqual([]);
  });

  it('detects a gap larger than the threshold', () => {
    const points = [dp(0), dp(30), dp(31)];
    const gaps = detectGaps(points, DEFAULT_GAP_THRESHOLD_DAYS);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapDays).toBe(30);
    expect(gaps[0].beforeIdx).toBe(0);
    expect(gaps[0].afterIdx).toBe(1);
  });

  it('sorts input before scanning', () => {
    const points = [dp(30), dp(0), dp(31)];
    const gaps = detectGaps(points, DEFAULT_GAP_THRESHOLD_DAYS);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapDays).toBe(30);
  });

  it('honours a custom threshold', () => {
    const points = [dp(0), dp(5), dp(10)];
    expect(detectGaps(points, 3)).toHaveLength(2);
    expect(detectGaps(points, 10)).toHaveLength(0);
  });

  it('ignores gaps exactly equal to the threshold', () => {
    const points = [dp(0), dp(14)];
    // Threshold is 14 days, so 14 days exactly is NOT > threshold
    expect(detectGaps(points, 14)).toHaveLength(0);
  });
});

describe('buildGapCompression', () => {
  it('returns identity-ish mapping for empty data', () => {
    const result = buildGapCompression([], [], new Set(), 360, LAYOUT);
    expect(result.dateToX(new Date())).toBe(0.5);
    expect(result.gaps).toEqual([]);
    expect(result.timeAxisLabels).toEqual([]);
  });

  it('produces a linear mapping when no gaps are detected', () => {
    const points = [dp(0), dp(7), dp(13)];
    const result = buildGapCompression(points, [], new Set(), 360, LAYOUT);
    // First point maps to 0.05, last to 0.95
    expect(result.dateToX(points[0].date)).toBeCloseTo(0.05, 5);
    expect(result.dateToX(points[2].date)).toBeCloseTo(0.95, 5);
    expect(result.gaps).toEqual([]);
  });

  it('compresses gaps when expandedGaps is empty', () => {
    // Two clusters separated by a 60-day gap
    const points = [dp(0), dp(1), dp(60), dp(61)];
    const detected = detectGaps(points);
    const result = buildGapCompression(points, detected, new Set(), 360, LAYOUT);
    expect(result.gaps).toHaveLength(1);

    const firstX = result.dateToX(points[0].date);
    const secondX = result.dateToX(points[1].date);
    const thirdX = result.dateToX(points[2].date);
    const fourthX = result.dateToX(points[3].date);

    expect(firstX).toBeCloseTo(0.05, 5);
    // The gap should compress — the distance between the second cluster
    // start and the first cluster end should be smaller than the distance
    // it would be on a naive linear scale.
    const gapDelta = thirdX - secondX;
    const withinClusterDelta = fourthX - thirdX;
    // Compressed gap (5 days) is still larger than a 1-day within-cluster
    // step, but the ratio is bounded by COMPRESSED_GAP_DAYS / 1.
    expect(gapDelta / withinClusterDelta).toBeLessThan(10);
  });

  it('expands the gap to full width when expandedGaps includes it', () => {
    const points = [dp(0), dp(1), dp(60), dp(61)];
    const detected = detectGaps(points);
    const compressed = buildGapCompression(points, detected, new Set(), 360, LAYOUT);
    const expanded = buildGapCompression(points, detected, new Set([0]), 360, LAYOUT);

    const compressedGapWidth =
      compressed.dateToX(points[2].date) - compressed.dateToX(points[1].date);
    const expandedGapWidth = expanded.dateToX(points[2].date) - expanded.dateToX(points[1].date);

    // Expanded gap takes more horizontal space than compressed
    expect(expandedGapWidth).toBeGreaterThan(compressedGapWidth);
  });

  it('reports gap isExpanded flag correctly', () => {
    const points = [dp(0), dp(60)];
    const detected = detectGaps(points);
    const compressed = buildGapCompression(points, detected, new Set(), 360, LAYOUT);
    const expanded = buildGapCompression(points, detected, new Set([0]), 360, LAYOUT);
    expect(compressed.gaps[0].isExpanded).toBe(false);
    expect(expanded.gaps[0].isExpanded).toBe(true);
  });

  it('produces monotonically increasing timeAxisLabels by position', () => {
    const points = [dp(0), dp(60), dp(120), dp(180)];
    const detected = detectGaps(points);
    const result = buildGapCompression(points, detected, new Set(), 360, LAYOUT);
    for (let i = 1; i < result.timeAxisLabels.length; i++) {
      expect(result.timeAxisLabels[i].position).toBeGreaterThanOrEqual(
        result.timeAxisLabels[i - 1].position
      );
    }
  });

  it('keeps normalized positions within [0.05, 0.95]', () => {
    const points = [dp(0), dp(15), dp(60), dp(90)];
    const detected = detectGaps(points);
    const result = buildGapCompression(points, detected, new Set(), 360, LAYOUT);
    for (const p of points) {
      const x = result.dateToX(p.date);
      // Tolerate minor floating-point drift at the boundaries
      expect(x).toBeGreaterThanOrEqual(0.05 - 1e-6);
      expect(x).toBeLessThanOrEqual(0.95 + 1e-6);
    }
  });
});

describe('calculateChartWidth', () => {
  const baseOptions = {
    minPointSpacing: 50,
    baseChartWidth: 360,
    maxChartWidth: 4000,
    chartPaddingLeft: 40,
    chartPaddingRight: 20,
    compressedGapDays: DEFAULT_COMPRESSED_GAP_DAYS,
  };

  it('returns at least the base width for small datasets', () => {
    const width = calculateChartWidth(3, [], new Set(), baseOptions);
    expect(width).toBe(360);
  });

  it('grows with the number of points', () => {
    const width = calculateChartWidth(20, [], new Set(), baseOptions);
    // 20 * 50 + 40 + 20 = 1060
    expect(width).toBe(1060);
  });

  it('caps at maxChartWidth', () => {
    const width = calculateChartWidth(500, [], new Set(), baseOptions);
    expect(width).toBe(4000);
  });

  it('adds width when gaps are expanded', () => {
    const gaps = [
      {
        beforeIdx: 0,
        afterIdx: 1,
        gapDays: 60,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-03-02'),
      },
    ];
    const compressed = calculateChartWidth(10, gaps, new Set(), baseOptions);
    const expanded = calculateChartWidth(10, gaps, new Set([0]), baseOptions);
    // Expanded adds ~2px per extra day: (60 - 5) * 2 = 110
    expect(expanded - compressed).toBe(110);
  });

  it('leaves width untouched when a gap is detected but not expanded', () => {
    const gaps = [
      {
        beforeIdx: 0,
        afterIdx: 1,
        gapDays: 60,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-03-02'),
      },
    ];
    const unchanged = calculateChartWidth(10, gaps, new Set(), baseOptions);
    const baseline = calculateChartWidth(10, [], new Set(), baseOptions);
    expect(unchanged).toBe(baseline);
  });
});

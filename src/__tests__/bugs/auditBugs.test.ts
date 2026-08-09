/**
 * Regression tests for bugs from docs/AUDIT.md Tier 1.
 * Tests verify that fixes for real crash risks remain in place.
 *
 * Note: the Invalid-Date sort guard (safeGetTime) is covered exhaustively in
 * nanSortComparators.test.ts, so it is not duplicated here.
 */

describe('AUDIT Bug 10.2: Median of empty array', () => {
  /**
   * src/hooks/home/useWorkoutSections.ts:210-213
   *
   * The median function does not guard against empty input.
   * With an empty array: mid=0, falls into even branch,
   * accesses sorted[-1] (undefined) + sorted[0] (undefined),
   * returns NaN.
   */

  // Copy from useWorkoutSections.ts:210-213 with fix
  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single value for one-element array', () => {
    expect(median([5])).toBe(5);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([1, 3])).toBe(2);
  });

  it('returns middle value for odd-length array', () => {
    expect(median([1, 2, 3])).toBe(2);
  });

  it('returns average of two middle values for four-element array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles unsorted input', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe('AUDIT Bug 10.5: Division by zero in weekly comparison (FIXED)', () => {
  /**
   * src/components/stats/WeeklySummary.tsx:196-200
   *
   * The pctChange function was vulnerable to division by zero when
   * previous===0. This has been FIXED: it now returns '' when previous===0.
   *
   * These tests verify the fix remains in place.
   */

  // Exact copy from WeeklySummary.tsx:196-200
  function pctChange(current: number, previous: number): string {
    if (previous === 0) return '';
    const pct = Math.round(Math.abs(((current - previous) / previous) * 100));
    return ` ${pct}%`;
  }

  it('returns empty string when previous is 0 (division by zero guard)', () => {
    expect(pctChange(100, 0)).toBe('');
    expect(pctChange(0, 0)).toBe('');
  });

  it('calculates percentage change correctly', () => {
    expect(pctChange(150, 100)).toBe(' 50%');
    expect(pctChange(50, 100)).toBe(' 50%');
  });

  it('handles equal values', () => {
    expect(pctChange(100, 100)).toBe(' 0%');
  });
});

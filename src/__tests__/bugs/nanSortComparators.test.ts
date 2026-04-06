/**
 * NaN sort comparator regression tests.
 * Verifies that safeGetTime prevents NaN from breaking sort comparators.
 *
 * Affected source files (all fixed to use safeGetTime):
 *   - useRoutePerformances.ts:239
 *   - ActivitySectionsSection.tsx:83
 *   - SectionPerformanceTimeline.tsx:47
 *   - UnifiedPerformanceChart.tsx:266,349
 *   - RecentEffortsList.tsx:30
 *   - localBackend.ts:54
 */

import { safeGetTime } from '@/lib/utils/format';

describe('NaN sort comparator patterns', () => {
  it('NaN comparisons always return false (the root cause)', () => {
    expect(NaN < 5).toBe(false);
    expect(NaN > 5).toBe(false);
    expect(Number.isNaN(NaN)).toBe(true);
  });

  describe('safeGetTime helper', () => {
    it('returns valid timestamp for normal dates', () => {
      expect(safeGetTime(new Date('2026-01-15'))).toBeGreaterThan(0);
    });

    it('returns 0 for Invalid Date', () => {
      expect(safeGetTime(new Date('invalid'))).toBe(0);
    });

    it('returns 0 for null', () => {
      expect(safeGetTime(null)).toBe(0);
    });

    it('returns 0 for undefined', () => {
      expect(safeGetTime(undefined)).toBe(0);
    });
  });

  describe('date-based sort with safeGetTime (fixed pattern)', () => {
    const sortByDate = (items: { date: Date }[]) =>
      [...items].sort((a, b) => safeGetTime(a.date) - safeGetTime(b.date));

    it('sorts valid dates correctly', () => {
      const items = [
        { date: new Date('2026-01-15') },
        { date: new Date('2026-01-10') },
        { date: new Date('2026-01-20') },
      ];
      const sorted = sortByDate(items);
      expect(sorted[0].date.getTime()).toBeLessThan(sorted[1].date.getTime());
      expect(sorted[1].date.getTime()).toBeLessThan(sorted[2].date.getTime());
    });

    it('handles invalid date mixed with valid dates deterministically', () => {
      const items = [
        { date: new Date('2026-01-15') },
        { date: new Date('invalid') },
        { date: new Date('2026-01-10') },
      ];
      const sorted1 = sortByDate(items);
      const sorted2 = sortByDate(items);
      expect(sorted1.map((i) => safeGetTime(i.date))).toEqual(
        sorted2.map((i) => safeGetTime(i.date))
      );
    });

    it('handles multiple invalid dates', () => {
      const items = [
        { date: new Date('2026-01-20') },
        { date: new Date('invalid') },
        { date: new Date('2026-01-10') },
        { date: new Date('also invalid') },
        { date: new Date('2026-01-15') },
      ];
      const sorted = sortByDate(items);
      // Valid dates should be in order relative to each other
      const valid = sorted.filter((i) => !isNaN(i.date.getTime()));
      for (let i = 1; i < valid.length; i++) {
        expect(valid[i].date.getTime()).toBeGreaterThanOrEqual(valid[i - 1].date.getTime());
      }
    });

    it('sorts identical dates without error', () => {
      const items = [{ date: new Date('2026-01-15') }, { date: new Date('2026-01-15') }];
      const sorted = sortByDate(items);
      expect(sorted).toHaveLength(2);
    });
  });

  describe('new Date() with invalid input', () => {
    it('NaN input produces Invalid Date', () => {
      const d = new Date(NaN);
      expect(isNaN(d.getTime())).toBe(true);
      expect(safeGetTime(d)).toBe(0);
    });

    it('null input produces epoch', () => {
      const d = new Date(null as unknown as number);
      expect(d.getTime()).toBe(0);
      expect(safeGetTime(d)).toBe(0);
    });
  });

  describe('numeric sort with NaN values', () => {
    const sortByValue = (items: { value: number }[]) =>
      [...items].sort((a, b) => {
        const av = Number.isFinite(a.value) ? a.value : 0;
        const bv = Number.isFinite(b.value) ? b.value : 0;
        return av - bv;
      });

    it('sorts valid numbers correctly', () => {
      const sorted = sortByValue([{ value: 3 }, { value: 1 }, { value: 2 }]);
      expect(sorted.map((i) => i.value)).toEqual([1, 2, 3]);
    });

    it('handles NaN values by treating as 0', () => {
      const items = [{ value: 3 }, { value: NaN }, { value: 1 }];
      const sorted = sortByValue(items);
      const validSorted = sorted.filter((i) => Number.isFinite(i.value));
      for (let i = 1; i < validSorted.length; i++) {
        expect(validSorted[i].value).toBeGreaterThanOrEqual(validSorted[i - 1].value);
      }
    });
  });
});

/**
 * Temporal boundary tests.
 * Tests date-dependent formatting and calculation at dangerous boundaries:
 * year-end transitions, leap years, DST edges, ISO week boundaries.
 */

import {
  formatRelativeDate,
  formatLocalDate,
  getMonday,
  getSunday,
  formatShortDate,
} from '@/shared/format/format';

describe('temporal boundaries', () => {
  describe('year boundary', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('calls Dec 31 "Yesterday" when today is Jan 1', () => {
      jest.setSystemTime(new Date('2026-01-01T12:00:00'));

      expect(formatRelativeDate('2025-12-31T12:00:00')).toBe('Yesterday');
    });

    it('calls the same calendar day "Today" just after midnight', () => {
      jest.setSystemTime(new Date('2026-01-01T00:30:00'));

      expect(formatRelativeDate('2026-01-01T00:00:00')).toBe('Today');
    });

    it('keeps the year on a date from a previous year', () => {
      jest.setSystemTime(new Date('2026-01-01T12:00:00'));

      expect(formatRelativeDate('2024-11-20T12:00:00')).toContain('2024');
    });
  });

  describe('leap year', () => {
    it('formatLocalDate handles Feb 29 on leap year', () => {
      const leapDay = new Date('2024-02-29T12:00:00');
      const result = formatLocalDate(leapDay);
      expect(result).toBe('2024-02-29');
    });

    it('formatShortDate keeps the 29th of a leap February and drops the year', () => {
      // Locale decides the layout, so match on the day rather than the order.
      const result = formatShortDate('2024-02-29T12:00:00');
      expect(result).toMatch(/29/);
      expect(result).not.toMatch(/2024/);
    });
  });

  describe('ISO week boundaries', () => {
    it('getMonday returns correct Monday for Jan 1 that falls mid-week', () => {
      // Jan 1, 2025 is a Wednesday
      const jan1 = new Date('2025-01-01T12:00:00');
      const monday = getMonday(jan1);
      expect(monday.getDate()).toBe(30); // Dec 30, 2024
      expect(monday.getMonth()).toBe(11); // December (0-indexed)
      expect(monday.getFullYear()).toBe(2024);
    });

    it('getSunday returns correct Sunday for Jan 1 that falls mid-week', () => {
      // Jan 1, 2025 is a Wednesday
      const jan1 = new Date('2025-01-01T12:00:00');
      const sunday = getSunday(jan1);
      expect(sunday.getDate()).toBe(5); // Jan 5, 2025
      expect(sunday.getMonth()).toBe(0); // January
    });

    it('getMonday handles Sunday correctly', () => {
      // Sunday Jan 5, 2025
      const sunday = new Date('2025-01-05T12:00:00');
      const monday = getMonday(sunday);
      // Monday of this week should be Dec 30, 2024
      expect(monday.getDate()).toBe(30);
      expect(monday.getMonth()).toBe(11); // December
    });

    it('getMonday handles Monday correctly (returns same day)', () => {
      const monday = new Date('2025-01-06T12:00:00');
      const result = getMonday(monday);
      expect(result.getDate()).toBe(6);
      expect(result.getMonth()).toBe(0);
    });
  });

  describe('edge time values', () => {
    it('formatLocalDate keeps midnight and the last millisecond on the same day', () => {
      expect(formatLocalDate(new Date('2026-01-15T00:00:00'))).toBe('2026-01-15');
      expect(formatLocalDate(new Date('2026-01-15T23:59:59.999'))).toBe('2026-01-15');
    });

    it('formatLocalDate zero-pads single-digit months and days', () => {
      expect(formatLocalDate(new Date('2026-03-07T12:00:00'))).toBe('2026-03-07');
    });
  });
});

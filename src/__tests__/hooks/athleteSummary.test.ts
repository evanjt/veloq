/**
 * Tests for pure utility functions exported from useAthleteSummary.
 * Tests getISOWeekNumber and formatWeekRange without React hooks, and the
 * week bounds they are shown beside, against the production helpers.
 */

import { getISOWeekNumber, formatWeekRange } from '@/features/fitness/hooks/useAthleteSummary';
import { getMonday, getSunday } from '@/shared/format/format';

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

jest.mock('@/shared/format/format', () => ({
  ...jest.requireActual('@/shared/format/format'),
  getIntlLocale: () => 'en-US',
}));

// ---------------------------------------------------------------------------
// getISOWeekNumber
// ---------------------------------------------------------------------------

describe('getISOWeekNumber', () => {
  it('returns ISO week 1 for week-1 dates across year boundaries', () => {
    const cases: [Date, string][] = [
      [new Date(2024, 0, 1), 'Jan 1 2024 (Monday) is ISO week 1'],
      [new Date(2024, 11, 31), 'Dec 31 2024 (Tuesday) → ISO week 1 of 2025'],
      [new Date(2026, 0, 1), 'Jan 1 2026 (Thursday) → first-Thursday week is week 1'],
      [new Date(2025, 11, 29), 'Dec 29 2025 (Monday) → week 1 of 2026'],
    ];
    for (const [date, label] of cases) {
      expect({ label, week: getISOWeekNumber(date) }).toEqual({ label, week: 1 });
    }
  });

  it('returns the mid-year week number, and week 1 for Dec 31 2025', () => {
    expect(getISOWeekNumber(new Date(2026, 0, 27))).toBe(5);
    expect(getISOWeekNumber(new Date(2025, 11, 31))).toBe(1);
  });

  it('returns consistent results for all days in same week', () => {
    // Week of 2025-03-03 (Monday) to 2025-03-09 (Sunday)
    const weekNum = getISOWeekNumber(new Date(2025, 2, 3));
    for (let d = 3; d <= 9; d++) {
      expect(getISOWeekNumber(new Date(2025, 2, d))).toBe(weekNum);
    }
  });
});

// ---------------------------------------------------------------------------
// formatWeekRange
// ---------------------------------------------------------------------------

describe('formatWeekRange', () => {
  it('formats same-month, cross-month, and cross-year week ranges', () => {
    const cases: [Date, string][] = [
      [new Date(2025, 0, 20), 'Jan 20-26'], // same month
      [new Date(2025, 0, 27), 'Jan 27 - Feb 2'], // cross month
      [new Date(2025, 11, 29), 'Dec 29 - Jan 4'], // cross year
      [new Date(2025, 1, 24), 'Feb 24 - Mar 2'], // February into March
      [new Date(2025, 5, 2), 'Jun 2-8'], // entirely within a month
    ];
    for (const [monday, expected] of cases) {
      expect(formatWeekRange(monday)).toBe(expected);
    }
  });
});

describe('the calendar week around a date', () => {
  it('starts on the Monday and ends on the Sunday, for a Monday, a Saturday and a Sunday', () => {
    for (const day of [19, 24, 25]) {
      const date = new Date(2026, 0, day, 14, 0, 0);
      const monday = getMonday(date);
      const sunday = getSunday(date);
      expect([monday.getMonth(), monday.getDate(), monday.getHours()]).toEqual([0, 19, 0]);
      expect([sunday.getMonth(), sunday.getDate()]).toEqual([0, 25]);
      expect(formatWeekRange(monday)).toBe('Jan 19-25');
      expect(getISOWeekNumber(date)).toBe(4);
    }
  });

  it('reaches back across a month boundary from a Sunday', () => {
    const monday = getMonday(new Date(2026, 1, 1));
    expect([monday.getMonth(), monday.getDate()]).toEqual([0, 26]);
  });

  it('keeps an activity inside the week that its Saturday falls in', () => {
    const saturday = new Date(2026, 0, 24, 23, 59, 0);
    const start = getMonday(saturday).getTime();
    const end = getSunday(saturday).getTime() + 24 * 60 * 60 * 1000 - 1;
    expect(saturday.getTime()).toBeGreaterThanOrEqual(start);
    expect(saturday.getTime()).toBeLessThanOrEqual(end);
  });
});

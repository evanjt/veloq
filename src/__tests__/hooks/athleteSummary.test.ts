/**
 * Tests for pure utility functions exported from useAthleteSummary.
 * Tests getISOWeekNumber and formatWeekRange without React hooks.
 */

// Mock the full import chain that useAthleteSummary pulls in
jest.mock('@/api', () => ({
  intervalsApi: {},
}));

jest.mock('@/features/auth/store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

jest.mock('@/shared/format/format', () => ({
  formatLocalDate: jest.fn(),
  getMonday: jest.fn(),
  getSunday: (monday: Date) => {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return sunday;
  },
  getIntlLocale: () => 'en-US',
}));

import { getISOWeekNumber, formatWeekRange } from '@/features/fitness/hooks/useAthleteSummary';

// ---------------------------------------------------------------------------
// getISOWeekNumber
// ---------------------------------------------------------------------------

describe('getISOWeekNumber', () => {
  it('returns ISO week 1 for week-1 dates across year boundaries', () => {
    const cases: Array<[Date, string]> = [
      [new Date(2024, 0, 1), 'Jan 1 2024 (Monday) is ISO week 1'],
      [new Date(2024, 11, 31), 'Dec 31 2024 (Tuesday) → ISO week 1 of 2025'],
      [new Date(2026, 0, 1), 'Jan 1 2026 (Thursday) → first-Thursday week is week 1'],
      [new Date(2025, 11, 29), 'Dec 29 2025 (Monday) → week 1 of 2026'],
    ];
    for (const [date, label] of cases) {
      expect({ label, week: getISOWeekNumber(date) }).toEqual({ label, week: 1 });
    }
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
    const cases: Array<[Date, string]> = [
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

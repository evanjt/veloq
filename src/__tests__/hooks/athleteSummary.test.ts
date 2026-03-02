/**
 * Tests for pure utility functions exported from useAthleteSummary.
 * Tests getISOWeekNumber and formatWeekRange without React hooks.
 */

// Mock the full import chain that useAthleteSummary pulls in
jest.mock('@/api', () => ({
  intervalsApi: {},
}));

jest.mock('@/providers', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/lib/native/routeEngine', () => ({
  getRouteEngine: () => null,
}));

jest.mock('@/lib', () => ({
  formatLocalDate: jest.fn(),
  getMonday: jest.fn(),
  getSunday: (monday: Date) => {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return sunday;
  },
}));

import { getISOWeekNumber, formatWeekRange } from '@/hooks/fitness/useAthleteSummary';

// ---------------------------------------------------------------------------
// getISOWeekNumber
// ---------------------------------------------------------------------------

describe('getISOWeekNumber', () => {
  it('returns week 1 for Jan 1 2024 (Monday)', () => {
    // 2024-01-01 is a Monday, and it's in ISO week 1
    expect(getISOWeekNumber(new Date(2024, 0, 1))).toBe(1);
  });

  it('returns week 52 or 53 for Dec 31 depending on year', () => {
    // 2024-12-31 is a Tuesday → ISO week 1 of 2025
    expect(getISOWeekNumber(new Date(2024, 11, 31))).toBe(1);
  });

  it('returns week 1 for Jan 1 2026 (Thursday)', () => {
    // 2026-01-01 is a Thursday → week containing first Thursday → week 1
    expect(getISOWeekNumber(new Date(2026, 0, 1))).toBe(1);
  });

  it('returns week 53 for Dec 31 2026 (Thursday)', () => {
    // 2026-12-31 is Thursday. 2026 starts on Thursday, so it has 53 weeks.
    expect(getISOWeekNumber(new Date(2026, 11, 31))).toBe(53);
  });

  it('returns correct week for mid-year date', () => {
    // 2025-06-15 is a Sunday → ISO treats Sunday as end of week
    // Week of June 9-15 2025 → week 24
    expect(getISOWeekNumber(new Date(2025, 5, 15))).toBe(24);
  });

  it('handles year boundary: Dec 29 2025 (Monday) is week 1 of 2026', () => {
    // 2025-12-29 is a Monday. The Thursday of that week is Jan 1 2026 → week 1 of 2026
    expect(getISOWeekNumber(new Date(2025, 11, 29))).toBe(1);
  });

  it('handles year boundary: Dec 28 2025 (Sunday) is still week 52 of 2025', () => {
    // 2025-12-28 is a Sunday, end of the previous week
    expect(getISOWeekNumber(new Date(2025, 11, 28))).toBe(52);
  });

  it('returns week 1 for first week of 2023 (Jan 2 is Monday)', () => {
    // 2023-01-02 is Monday → ISO week 1
    expect(getISOWeekNumber(new Date(2023, 0, 2))).toBe(1);
    // 2023-01-01 is Sunday → ISO week 52 of 2022
    expect(getISOWeekNumber(new Date(2023, 0, 1))).toBe(52);
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
  it('formats same-month range (e.g., "Jan 20-26")', () => {
    const monday = new Date(2025, 0, 20); // Jan 20, 2025 (Monday)
    const result = formatWeekRange(monday);
    expect(result).toBe('Jan 20-26');
  });

  it('formats cross-month range (e.g., "Jan 27 - Feb 2")', () => {
    const monday = new Date(2025, 0, 27); // Jan 27, 2025 (Monday)
    const result = formatWeekRange(monday);
    expect(result).toBe('Jan 27 - Feb 2');
  });

  it('formats cross-year range (e.g., "Dec 29 - Jan 4")', () => {
    const monday = new Date(2025, 11, 29); // Dec 29, 2025 (Monday)
    const result = formatWeekRange(monday);
    expect(result).toBe('Dec 29 - Jan 4');
  });

  it('formats February week correctly', () => {
    const monday = new Date(2025, 1, 24); // Feb 24, 2025 (Monday)
    const result = formatWeekRange(monday);
    // Feb 24 to Mar 2
    expect(result).toBe('Feb 24 - Mar 2');
  });

  it('formats a week entirely within a month', () => {
    const monday = new Date(2025, 5, 2); // Jun 2, 2025 (Monday)
    const result = formatWeekRange(monday);
    expect(result).toBe('Jun 2-8');
  });
});

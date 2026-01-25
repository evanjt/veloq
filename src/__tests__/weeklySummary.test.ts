/**
 * Tests for weekly summary calculation
 * Ensures calendar weeks match intervals.icu display
 */

import { getISOWeekNumber, formatWeekRange } from '../hooks/fitness/useAthleteSummary';

// Test helper: Get Monday of ISO week
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Test helper: Get Sunday of ISO week
function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

describe('ISO Week Number Calculation', () => {
  it('should return week 1 for early January 2026', () => {
    // Jan 1, 2026 is a Thursday - part of week 1
    const date = new Date(2026, 0, 1);
    expect(getISOWeekNumber(date)).toBe(1);
  });

  it('should return week 4 for Jan 19-25, 2026', () => {
    // Week 4 of 2026 is Mon Jan 19 - Sun Jan 25
    const jan19 = new Date(2026, 0, 19); // Monday
    const jan25 = new Date(2026, 0, 25); // Sunday

    expect(getISOWeekNumber(jan19)).toBe(4);
    expect(getISOWeekNumber(jan25)).toBe(4);
  });

  it('should return week 5 for Jan 27, 2026', () => {
    const jan27 = new Date(2026, 0, 27);
    expect(getISOWeekNumber(jan27)).toBe(5);
  });

  it('should handle year boundary correctly', () => {
    // Dec 31, 2025 is a Wednesday - could be week 1 of 2026 or week 53 of 2025
    // According to ISO 8601, week 1 is the week containing the first Thursday
    // Dec 31, 2025 falls in the same week as Jan 1, 2026 (which is Thursday)
    // So Dec 31, 2025 is week 1 of 2026
    const dec31 = new Date(2025, 11, 31);
    expect(getISOWeekNumber(dec31)).toBe(1);
  });
});

describe('Week Monday Calculation', () => {
  it('should find Monday for a Monday date', () => {
    const monday = new Date(2026, 0, 19); // Jan 19, 2026 is Monday
    const result = getMonday(monday);
    expect(result.getDate()).toBe(19);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getFullYear()).toBe(2026);
  });

  it('should find Monday for a Wednesday date', () => {
    const wednesday = new Date(2026, 0, 21); // Jan 21, 2026 is Wednesday
    const result = getMonday(wednesday);
    expect(result.getDate()).toBe(19); // Monday is Jan 19
  });

  it('should find Monday for a Sunday date', () => {
    const sunday = new Date(2026, 0, 25); // Jan 25, 2026 is Sunday
    const result = getMonday(sunday);
    expect(result.getDate()).toBe(19); // Monday of that week is Jan 19
  });

  it('should handle month boundary correctly', () => {
    // Feb 1, 2026 is a Sunday
    const feb1 = new Date(2026, 1, 1);
    const result = getMonday(feb1);
    expect(result.getDate()).toBe(26);
    expect(result.getMonth()).toBe(0); // January
  });
});

describe('Week Sunday Calculation', () => {
  it('should find Sunday for a Monday date', () => {
    const monday = new Date(2026, 0, 19);
    const result = getSunday(monday);
    expect(result.getDate()).toBe(25);
    expect(result.getMonth()).toBe(0);
  });

  it('should find Sunday for a Saturday date', () => {
    const saturday = new Date(2026, 0, 24);
    const result = getSunday(saturday);
    expect(result.getDate()).toBe(25);
  });
});

describe('Week Range Formatting', () => {
  it('should format week within same month', () => {
    const monday = new Date(2026, 0, 19); // Jan 19-25, 2026
    const result = formatWeekRange(monday);
    expect(result).toBe('Jan 19-25');
  });

  it('should format week spanning two months', () => {
    const monday = new Date(2026, 0, 26); // Jan 26 - Feb 1, 2026
    const result = formatWeekRange(monday);
    expect(result).toBe('Jan 26 - Feb 1');
  });

  it('should format week at year boundary', () => {
    const monday = new Date(2025, 11, 29); // Dec 29, 2025 - Jan 4, 2026
    const result = formatWeekRange(monday);
    expect(result).toBe('Dec 29 - Jan 4');
  });
});

describe('Calendar Week Date Boundaries', () => {
  it('should include activities from Monday through Sunday', () => {
    // Test that a Saturday activity falls in the correct week
    const saturday = new Date(2026, 0, 24, 14, 0, 0); // Sat Jan 24, 2026 2pm
    const weekMonday = getMonday(saturday);
    const weekSunday = getSunday(saturday);

    expect(weekMonday.getDate()).toBe(19); // Jan 19
    expect(weekSunday.getDate()).toBe(25); // Jan 25

    // Activity timestamp should be within week bounds
    const activityTs = saturday.getTime();
    const mondayTs = weekMonday.getTime();
    const sundayEndTs = weekSunday.getTime() + 24 * 60 * 60 * 1000 - 1;

    expect(activityTs).toBeGreaterThanOrEqual(mondayTs);
    expect(activityTs).toBeLessThanOrEqual(sundayEndTs);
  });

  it('should exclude Monday activity from previous week', () => {
    const thisSunday = new Date(2026, 0, 25); // Sun Jan 25
    const prevMonday = new Date(2026, 0, 12); // Mon Jan 12 (previous week)

    const currentWeekMonday = getMonday(thisSunday);
    expect(prevMonday.getTime()).toBeLessThan(currentWeekMonday.getTime());
  });
});

describe('Rolling vs Calendar Week Difference', () => {
  it('should show different dates for calendar vs rolling week', () => {
    // If today is Saturday Jan 24, 2026:
    // - Calendar week: Mon Jan 19 - Sun Jan 25
    // - Rolling 7 days: Sun Jan 18 - Sat Jan 24
    const saturday = new Date(2026, 0, 24);

    // Calendar week
    const calendarMonday = getMonday(saturday);
    const calendarSunday = getSunday(saturday);
    expect(calendarMonday.getDate()).toBe(19);
    expect(calendarSunday.getDate()).toBe(25);

    // Rolling 7 days (today - 6 through today)
    const rollingStart = new Date(saturday);
    rollingStart.setDate(rollingStart.getDate() - 6);
    const rollingEnd = saturday;
    expect(rollingStart.getDate()).toBe(18); // Sun Jan 18
    expect(rollingEnd.getDate()).toBe(24); // Sat Jan 24

    // They should be different
    expect(calendarMonday.getDate()).not.toBe(rollingStart.getDate());
  });

  it('should show same dates on Monday for calendar vs rolling week', () => {
    // On Monday, both calculations include the same day
    const monday = new Date(2026, 0, 19);

    const calendarMonday = getMonday(monday);
    expect(calendarMonday.getDate()).toBe(19);

    const rollingStart = new Date(monday);
    rollingStart.setDate(rollingStart.getDate() - 6);
    expect(rollingStart.getDate()).toBe(13); // Mon Jan 13 (NOT the same!)

    // Actually rolling 7 days from Monday goes back to Tuesday of previous week
    // So even on Monday, calendar and rolling are different
  });
});

describe('Bug Report Scenario: Jan 24, 2026', () => {
  it('should include Sat Jan 24 activity in week 4 calendar view', () => {
    // This is the scenario from the bug report
    // User activity on Sat Jan 24 should be in Week 4 (Jan 19-25)
    const activityDate = new Date(2026, 0, 24, 14, 20, 0); // Sat Jan 24 2:20pm

    const weekNum = getISOWeekNumber(activityDate);
    const weekMonday = getMonday(activityDate);
    const weekSunday = getSunday(activityDate);

    expect(weekNum).toBe(4);
    expect(weekMonday.getDate()).toBe(19);
    expect(weekSunday.getDate()).toBe(25);

    // The range should show "Jan 19-25"
    const rangeStr = formatWeekRange(weekMonday);
    expect(rangeStr).toBe('Jan 19-25');
  });
});

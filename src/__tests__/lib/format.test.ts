/**
 * Tests for formatting utilities.
 *
 * Assumptions:
 * - All values from the API can be 0, negative (erroneous), NaN, or undefined
 * - Users should never see "NaN", "undefined", "Infinity" in the UI
 * - Invalid inputs should produce sensible fallbacks, not crash
 */

import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPaceCompact,
  formatSwimPace,
  formatSpeed,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatLocalDate,
  formatRelativeDate,
  clamp,
} from '@/lib/utils/format';

describe('formatDistance', () => {
  it('shows meters below 1km, kilometers above', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(42195)).toBe('42.2 km');
  });

  it('handles boundary at exactly 1km', () => {
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1001)).toBe('1.0 km');
  });

  it('handles invalid inputs from corrupted API data', () => {
    expect(formatDistance(-100)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(Infinity)).toBe('0 m');
    expect(formatDistance(-Infinity)).toBe('0 m');
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations as M:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(61)).toBe('1:01');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hour+ durations as H:MM:SS', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('handles invalid inputs', () => {
    expect(formatDuration(-30)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });
});

describe('formatPace', () => {
  it('converts m/s to min/km pace', () => {
    // 5 m/s = 200 seconds/km = 3:20/km
    expect(formatPace(5)).toBe('3:20 /km');
    // 4 m/s = 250 seconds/km = 4:10/km
    expect(formatPace(4)).toBe('4:10 /km');
  });

  it('shows placeholder for zero/negative/invalid speed', () => {
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(-1)).toBe('--:--');
    expect(formatPace(NaN)).toBe('--:--');
    expect(formatPace(Infinity)).toBe('--:--');
  });
});

describe('formatSwimPace', () => {
  it('converts m/s to min:sec per 100m', () => {
    // 1 m/s = 100 seconds/100m = 1:40
    expect(formatSwimPace(1)).toBe('1:40');
    // 2 m/s = 50 seconds/100m = 0:50
    expect(formatSwimPace(2)).toBe('0:50');
  });

  it('handles invalid inputs', () => {
    expect(formatSwimPace(0)).toBe('--:--');
    expect(formatSwimPace(NaN)).toBe('--:--');
  });
});

describe('formatSpeed', () => {
  it('converts m/s to km/h', () => {
    expect(formatSpeed(10)).toBe('36.0 km/h');
    expect(formatSpeed(0)).toBe('0.0 km/h');
  });

  it('handles invalid inputs', () => {
    expect(formatSpeed(-5)).toBe('0.0 km/h');
    expect(formatSpeed(NaN)).toBe('0.0 km/h');
    expect(formatSpeed(Infinity)).toBe('0.0 km/h');
  });
});

describe('formatElevation', () => {
  it('rounds to nearest meter', () => {
    expect(formatElevation(500.4)).toBe('500 m');
    expect(formatElevation(500.6)).toBe('501 m');
  });

  it('handles null/undefined/NaN from missing API data', () => {
    expect(formatElevation(null)).toBe('0 m');
    expect(formatElevation(undefined)).toBe('0 m');
    expect(formatElevation(NaN)).toBe('0 m');
  });
});

describe('formatHeartRate', () => {
  it('formats with bpm unit', () => {
    expect(formatHeartRate(140)).toBe('140 bpm');
  });

  it('handles invalid inputs', () => {
    expect(formatHeartRate(NaN)).toBe('0 bpm');
    expect(formatHeartRate(-50)).toBe('0 bpm');
  });
});

describe('formatPower', () => {
  it('formats with W unit', () => {
    expect(formatPower(250)).toBe('250 W');
  });

  it('handles invalid inputs', () => {
    expect(formatPower(NaN)).toBe('0 W');
    expect(formatPower(-100)).toBe('0 W');
  });
});

describe('formatCalories', () => {
  it('shows raw number below 1000, abbreviated above', () => {
    expect(formatCalories(500)).toBe('500');
    expect(formatCalories(1500)).toBe('1.5k');
  });

  it('handles invalid inputs', () => {
    expect(formatCalories(NaN)).toBe('0');
    expect(formatCalories(-100)).toBe('0');
  });
});

describe('formatRelativeDate', () => {
  // These tests use real dates, which makes them time-sensitive
  // We use fixed offsets from "now" to make them deterministic

  it('shows "Today" for today', () => {
    const today = new Date().toISOString();
    expect(formatRelativeDate(today)).toBe('Today');
  });

  it('shows "Yesterday" for yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDate(yesterday)).toBe('Yesterday');
  });

  it('shows weekday name for dates within last 7 days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = formatRelativeDate(threeDaysAgo.toISOString());
    // Should be a weekday name like "Monday", "Tuesday", etc.
    expect([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]).toContain(result);
  });

  it('shows month and day for older dates this year', () => {
    // Use a date from earlier this year (January 15)
    // BUG: This test fails in early January when there are no dates
    // from the current year that are > 7 days old
    const thisYear = new Date().getFullYear();
    const earlierThisYear = new Date(thisYear, 0, 15).toISOString();
    const result = formatRelativeDate(earlierThisYear);
    // Should include month name (but format depends on current date)
    expect(result).toMatch(/Jan|15/);
  });
});

describe('formatLocalDate', () => {
  it('formats as YYYY-MM-DD in local timezone', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatLocalDate(date)).toBe('2024-01-15');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2024, 5, 5); // June 5, 2024
    expect(formatLocalDate(date)).toBe('2024-06-05');
  });
});

describe('clamp', () => {
  it('constrains value to range', () => {
    expect(clamp(5, 0, 10)).toBe(5); // within range
    expect(clamp(-5, 0, 10)).toBe(0); // below min
    expect(clamp(15, 0, 10)).toBe(10); // above max
  });

  it('handles edge cases at boundaries', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

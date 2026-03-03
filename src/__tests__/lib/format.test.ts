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
  formatPace,
  formatRelativeDate,
  formatTimeDelta,
  formatPerformanceDelta,
  getMonday,
  getSunday,
} from '@/lib/utils/format';

describe('formatDistance', () => {
  it('shows meters below 1km, kilometers above', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(42195)).toBe('42.2 km');
  });
});

describe('formatPace', () => {
  it('converts m/s to min/km pace', () => {
    // 5 m/s = 200 seconds/km = 3:20/km
    expect(formatPace(5)).toBe('3:20 /km');
    // 4 m/s = 250 seconds/km = 4:10/km
    expect(formatPace(4)).toBe('4:10 /km');
  });

  it('handles rounding edge case where seconds would round to 60', () => {
    // When seconds are >= 59.5, they round to 60, which should roll over to next minute
    // Speed that gives exactly 5:59.5 /km: 1000 / (5*60 + 59.5) = 1000 / 359.5 = 2.78164116
    expect(formatPace(2.78164116)).toBe('6:00 /km');
    // Speed that gives exactly 5:59.6 /km: 1000 / (5*60 + 59.6) = 1000 / 359.6 = 2.78086420
    expect(formatPace(2.7808642)).toBe('6:00 /km');
  });
});

describe('formatRelativeDate', () => {
  // Use mocked dates to make tests deterministic and avoid early-January edge cases
  const MOCK_NOW = new Date('2024-06-15T12:00:00Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(MOCK_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
    // Mock date is June 15, 2024 - so January 15, 2024 is definitely in the past
    const earlierThisYear = new Date(2024, 0, 15).toISOString(); // Jan 15, 2024
    const result = formatRelativeDate(earlierThisYear);
    // Should show "Jan 15" format for dates > 7 days old in current year
    expect(result).toMatch(/Jan.*15|15.*Jan/);
  });
});

describe('formatTimeDelta', () => {
  it('formats positive deltas (slower)', () => {
    expect(formatTimeDelta(90)).toBe('+1:30');
    expect(formatTimeDelta(5)).toBe('+5s');
  });

  it('formats negative deltas (faster)', () => {
    expect(formatTimeDelta(-90)).toBe('-1:30');
    expect(formatTimeDelta(-5)).toBe('-5s');
  });

  it('returns null for sub-second deltas', () => {
    expect(formatTimeDelta(0.5)).toBeNull();
    expect(formatTimeDelta(-0.3)).toBeNull();
    expect(formatTimeDelta(0)).toBeNull();
  });

  it('pads seconds with leading zero', () => {
    expect(formatTimeDelta(65)).toBe('+1:05');
  });
});

describe('formatPerformanceDelta', () => {
  it('returns null display for best performance', () => {
    const result = formatPerformanceDelta({ isBest: true });
    expect(result.deltaDisplay).toBeNull();
    expect(result.isFaster).toBe(false);
  });

  it('computes pace delta for running', () => {
    // Current 4 m/s = 250 s/km, Best 5 m/s = 200 s/km → delta +50s
    const result = formatPerformanceDelta({
      isBest: false,
      showPace: true,
      currentSpeed: 4,
      bestSpeed: 5,
    });
    expect(result.deltaDisplay).toBe('+50s');
    expect(result.isFaster).toBe(false);
  });

  it('detects faster pace', () => {
    const result = formatPerformanceDelta({
      isBest: false,
      showPace: true,
      currentSpeed: 5,
      bestSpeed: 4,
    });
    expect(result.isFaster).toBe(true);
  });

  it('uses timeDelta when not showPace', () => {
    const result = formatPerformanceDelta({
      isBest: false,
      timeDelta: 30,
    });
    expect(result.deltaDisplay).toBe('+30s');
    expect(result.isFaster).toBe(false);
  });

  it('returns null for missing data', () => {
    const result = formatPerformanceDelta({ isBest: false });
    expect(result.deltaDisplay).toBeNull();
  });
});

describe('getMonday / getSunday', () => {
  it('returns Monday for a Wednesday', () => {
    const wed = new Date(2026, 0, 14); // Wed Jan 14, 2026
    const mon = getMonday(wed);
    expect(mon.getDay()).toBe(1); // Monday
    expect(mon.getDate()).toBe(12);
  });

  it('getSunday returns Sunday of the same week', () => {
    const wed = new Date(2026, 0, 14);
    const sun = getSunday(wed);
    expect(sun.getDay()).toBe(0); // Sunday
    expect(sun.getDate()).toBe(18);
  });

  it('does not mutate input date', () => {
    const orig = new Date(2026, 0, 14);
    const origTime = orig.getTime();
    getMonday(orig);
    expect(orig.getTime()).toBe(origTime);
  });
});

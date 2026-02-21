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
  formatDurationHuman,
  formatPace,
  formatPaceCompact,
  formatSwimPace,
  formatSpeed,
  formatElevation,
  formatTemperature,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatTSS,
  formatLocalDate,
  formatRelativeDate,
  formatTimeDelta,
  formatPerformanceDelta,
  getMonday,
  getSunday,
  formatFileSize,
  speedToSecsPerKm,
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

  it('handles rounding edge case where seconds would round to 60', () => {
    // When seconds are >= 59.5, they round to 60, which should roll over to next minute
    // Speed that gives exactly 5:59.5 /km: 1000 / (5*60 + 59.5) = 1000 / 359.5 = 2.78164116
    expect(formatPace(2.78164116)).toBe('6:00 /km');
    // Speed that gives exactly 5:59.6 /km: 1000 / (5*60 + 59.6) = 1000 / 359.6 = 2.78086420
    expect(formatPace(2.7808642)).toBe('6:00 /km');
  });

  it('shows placeholder for zero/negative/invalid speed', () => {
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(-1)).toBe('--:--');
    expect(formatPace(NaN)).toBe('--:--');
    expect(formatPace(Infinity)).toBe('--:--');
  });
});

describe('formatPaceCompact', () => {
  it('converts m/s to min:sec pace without unit', () => {
    // 5 m/s = 200 seconds/km = 3:20
    expect(formatPaceCompact(5)).toBe('3:20');
    // 4 m/s = 250 seconds/km = 4:10
    expect(formatPaceCompact(4)).toBe('4:10');
  });

  it('handles rounding edge case where seconds would round to 60', () => {
    // Same edge case as formatPace, but without the unit
    expect(formatPaceCompact(2.78164116)).toBe('6:00');
    expect(formatPaceCompact(2.7808642)).toBe('6:00');
  });

  it('shows placeholder for invalid speed', () => {
    expect(formatPaceCompact(0)).toBe('--:--');
    expect(formatPaceCompact(NaN)).toBe('--:--');
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
    expect(formatCalories(500)).toBe('500 cal');
    expect(formatCalories(1500)).toBe('1.5k cal');
  });

  it('handles invalid inputs', () => {
    expect(formatCalories(NaN)).toBe('0 cal');
    expect(formatCalories(-100)).toBe('0 cal');
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

describe('formatDurationHuman', () => {
  it('formats seconds', () => {
    expect(formatDurationHuman(45)).toBe('45s');
    expect(formatDurationHuman(0)).toBe('0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDurationHuman(90)).toBe('1m 30s');
    expect(formatDurationHuman(300)).toBe('5m');
  });

  it('formats hours and minutes', () => {
    expect(formatDurationHuman(3600)).toBe('1h');
    expect(formatDurationHuman(5400)).toBe('1h 30m');
  });

  it('handles invalid inputs', () => {
    expect(formatDurationHuman(NaN)).toBe('0s');
    expect(formatDurationHuman(-10)).toBe('0s');
    expect(formatDurationHuman(Infinity)).toBe('0s');
  });
});

describe('formatTemperature', () => {
  it('formats celsius', () => {
    expect(formatTemperature(20)).toBe('20°C');
    expect(formatTemperature(0)).toBe('0°C');
    expect(formatTemperature(-5)).toBe('-5°C');
  });

  it('formats fahrenheit', () => {
    expect(formatTemperature(0, false)).toBe('32°F');
    expect(formatTemperature(100, false)).toBe('212°F');
  });

  it('handles null/undefined/NaN', () => {
    expect(formatTemperature(null)).toBe('--°C');
    expect(formatTemperature(undefined)).toBe('--°C');
    expect(formatTemperature(NaN)).toBe('--°C');
    expect(formatTemperature(null, false)).toBe('--°F');
  });
});

describe('formatTSS', () => {
  it('formats valid TSS', () => {
    expect(formatTSS(100)).toBe('100 TSS');
    expect(formatTSS(45.6)).toBe('46 TSS');
  });

  it('handles invalid inputs', () => {
    expect(formatTSS(NaN)).toBe('0 TSS');
    expect(formatTSS(-10)).toBe('0 TSS');
    expect(formatTSS(Infinity)).toBe('0 TSS');
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

  it('returns null for invalid inputs', () => {
    expect(formatTimeDelta(NaN)).toBeNull();
    expect(formatTimeDelta(Infinity)).toBeNull();
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

  it('returns Monday for a Sunday', () => {
    const sun = new Date(2026, 0, 18); // Sun Jan 18, 2026
    const mon = getMonday(sun);
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(12);
  });

  it('returns Monday for a Monday', () => {
    const mon = new Date(2026, 0, 12);
    const result = getMonday(mon);
    expect(result.getDate()).toBe(12);
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

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(2621440)).toBe('2.5 MB');
  });
});

describe('speedToSecsPerKm', () => {
  it('converts speed to pace', () => {
    expect(speedToSecsPerKm(1)).toBe(1000); // 1 m/s = 1000 s/km
    expect(speedToSecsPerKm(5)).toBe(200); // 5 m/s = 200 s/km
  });

  it('returns 0 for zero or negative speed', () => {
    expect(speedToSecsPerKm(0)).toBe(0);
    expect(speedToSecsPerKm(-1)).toBe(0);
  });
});

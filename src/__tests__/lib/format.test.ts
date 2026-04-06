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
  formatSpeed,
  formatPower,
  formatHeartRate,
  formatCalories,
  formatTSS,
  formatElevation,
  formatTemperature,
  formatSwimPace,
  formatFileSize,
  formatRelativeDate,
  formatTimeDelta,
  formatPerformanceDelta,
  speedToSecsPerKm,
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

// ============================================================
// EDGE CASE BUG HUNTING — invalid inputs should never leak
// "NaN", "undefined", "Infinity", or throw errors
// ============================================================

describe('formatDuration edge cases', () => {
  it('NaN returns fallback, not "NaN"', () => {
    const result = formatDuration(NaN);
    expect(result).not.toContain('NaN');
    expect(result).toBe('0:00');
  });

  it('Infinity returns fallback, not "Infinity"', () => {
    const result = formatDuration(Infinity);
    expect(result).not.toContain('Infinity');
    expect(result).toBe('0:00');
  });

  it('-Infinity returns fallback', () => {
    const result = formatDuration(-Infinity);
    expect(result).not.toContain('Infinity');
    expect(result).toBe('0:00');
  });

  it('negative value returns fallback', () => {
    const result = formatDuration(-1);
    expect(result).toBe('0:00');
  });

  it('zero returns "0:00"', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('formatDurationHuman edge cases', () => {
  it('NaN returns fallback, not "NaN"', () => {
    const result = formatDurationHuman(NaN);
    expect(result).not.toContain('NaN');
  });

  it('Infinity returns fallback, not "Infinity"', () => {
    const result = formatDurationHuman(Infinity);
    expect(result).not.toContain('Infinity');
  });

  /**
   * BUG: formatDurationHuman(59.5) returns "60s" instead of "1m"
   *
   * When seconds is 59.5, Math.round(59.5) === 60, but the function
   * checks seconds < 60 before rounding, so it takes the "< 60" branch
   * and produces "60s". The rounding to 60 should roll over to minutes.
   */
  it('59.5 seconds should not display as "60s"', () => {
    const result = formatDurationHuman(59.5);
    expect(result).not.toBe('60s');
    // Should show either "1m" or "60s" rounded to "1m"
    expect(result).toMatch(/^1m$/);
  });
});

describe('formatDistance edge cases', () => {
  it('NaN returns fallback, not "NaN"', () => {
    const result = formatDistance(NaN);
    expect(result).not.toContain('NaN');
  });

  it('Infinity returns fallback, not "Infinity"', () => {
    const result = formatDistance(Infinity);
    expect(result).not.toContain('Infinity');
  });

  it('negative returns fallback', () => {
    const result = formatDistance(-100);
    expect(result).toBe('0 m');
  });

  it('zero returns "0 m"', () => {
    expect(formatDistance(0)).toBe('0 m');
  });

  it('imperial NaN returns fallback', () => {
    const result = formatDistance(NaN, false);
    expect(result).not.toContain('NaN');
    expect(result).toBe('0 ft');
  });
});

describe('formatPace edge cases', () => {
  it('zero speed returns placeholder, not division-by-zero result', () => {
    const result = formatPace(0);
    expect(result).toBe('--:--');
    expect(result).not.toContain('Infinity');
  });

  it('NaN returns placeholder', () => {
    const result = formatPace(NaN);
    expect(result).toBe('--:--');
  });

  it('negative speed returns placeholder', () => {
    const result = formatPace(-5);
    expect(result).toBe('--:--');
  });

  it('Infinity returns placeholder', () => {
    const result = formatPace(Infinity);
    // Infinity m/s -> 1000/Infinity = 0 seconds/km -> should show 0:00 or --:--
    // Actually, Infinity IS finite? No, Number.isFinite(Infinity) = false
    expect(result).toBe('--:--');
  });
});

describe('formatSpeed edge cases', () => {
  it('undefined cast to number does not throw', () => {
    expect(() => formatSpeed(undefined as unknown as number)).not.toThrow();
    const result = formatSpeed(undefined as unknown as number);
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('NaN');
  });

  it('NaN returns fallback', () => {
    const result = formatSpeed(NaN);
    expect(result).not.toContain('NaN');
    expect(result).toBe('0.0 km/h');
  });

  it('Infinity returns fallback', () => {
    const result = formatSpeed(Infinity);
    expect(result).not.toContain('Infinity');
  });

  it('negative returns fallback', () => {
    expect(formatSpeed(-10)).toBe('0.0 km/h');
  });
});

describe('formatPower edge cases', () => {
  it('NaN returns fallback, not "NaN W"', () => {
    expect(formatPower(NaN)).toBe('0 W');
  });

  it('Infinity returns fallback', () => {
    expect(formatPower(Infinity)).toBe('0 W');
  });

  it('negative returns fallback', () => {
    expect(formatPower(-100)).toBe('0 W');
  });
});

describe('formatHeartRate edge cases', () => {
  it('NaN returns fallback', () => {
    expect(formatHeartRate(NaN)).toBe('0 bpm');
  });

  it('negative returns fallback', () => {
    expect(formatHeartRate(-60)).toBe('0 bpm');
  });
});

describe('formatCalories edge cases', () => {
  it('NaN returns fallback, not "NaN cal"', () => {
    expect(formatCalories(NaN)).toBe('0 cal');
  });

  it('Infinity returns fallback', () => {
    expect(formatCalories(Infinity)).toBe('0 cal');
  });
});

describe('formatTSS edge cases', () => {
  it('NaN returns fallback', () => {
    expect(formatTSS(NaN)).toBe('0 TSS');
  });

  it('Infinity returns fallback', () => {
    expect(formatTSS(Infinity)).toBe('0 TSS');
  });
});

describe('formatElevation edge cases', () => {
  it('null returns fallback', () => {
    expect(formatElevation(null)).toBe('0 m');
  });

  it('undefined returns fallback', () => {
    expect(formatElevation(undefined)).toBe('0 m');
  });

  it('NaN returns fallback', () => {
    expect(formatElevation(NaN)).toBe('0 m');
  });
});

describe('formatTemperature edge cases', () => {
  it('null returns placeholder', () => {
    expect(formatTemperature(null)).toBe('--°C');
  });

  it('NaN returns placeholder', () => {
    expect(formatTemperature(NaN)).toBe('--°C');
  });

  it('undefined returns placeholder', () => {
    expect(formatTemperature(undefined)).toBe('--°C');
  });
});

/**
 * BUG: formatFileSize does not guard against NaN, Infinity, or negative values.
 *
 * formatFileSize(NaN) returns "NaN B" because there is no Number.isFinite check.
 * formatFileSize(-1) returns "-1 B" which is nonsensical for a file size.
 * formatFileSize(Infinity) returns "Infinity B".
 *
 * Every other format function in the module guards against these, but formatFileSize
 * was missed.
 */
describe('formatFileSize edge cases', () => {
  it('NaN returns a sensible fallback, not "NaN B"', () => {
    const result = formatFileSize(NaN);
    expect(result).not.toContain('NaN');
  });

  it('negative returns a sensible fallback, not "-1 B"', () => {
    const result = formatFileSize(-1);
    // A file size should never be negative
    expect(result).not.toMatch(/-/);
  });

  it('Infinity returns a sensible fallback, not "Infinity B"', () => {
    const result = formatFileSize(Infinity);
    expect(result).not.toContain('Infinity');
  });

  it('zero returns "0 B"', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
});

/**
 * BUG: speedToSecsPerKm does not guard against NaN.
 *
 * speedToSecsPerKm(NaN) — the check `NaN <= 0` is false, so it proceeds to
 * compute 1000 / NaN = NaN. This can propagate NaN values through calculations.
 */
describe('speedToSecsPerKm edge cases', () => {
  it('NaN returns 0, not NaN', () => {
    const result = speedToSecsPerKm(NaN);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });

  it('Infinity returns 0, not a near-zero value', () => {
    // 1000 / Infinity = 0, which is technically correct but may cause issues downstream
    // The function should probably guard this
    const result = speedToSecsPerKm(Infinity);
    expect(result).toBe(0);
  });

  it('zero returns 0', () => {
    expect(speedToSecsPerKm(0)).toBe(0);
  });

  it('negative returns 0', () => {
    expect(speedToSecsPerKm(-5)).toBe(0);
  });
});

/**
 * BUG: formatTimeDelta near the 60-second boundary.
 *
 * formatTimeDelta(59.5): absDelta=59.5, minutes=0, seconds=Math.round(59.5 % 60)=60
 * Returns "+60s" instead of "+1:00".
 *
 * This is a rounding edge case where seconds round to 60 but the code doesn't
 * handle the rollover (unlike formatPace which does handle this case).
 */
describe('formatTimeDelta edge cases', () => {
  it('59.5 seconds should not produce "+60s"', () => {
    const result = formatTimeDelta(59.5);
    expect(result).not.toBe('+60s');
    // Should be "+1:00" since 59.5 rounds to 60s = 1m
    expect(result).toBe('+1:00');
  });

  it('-59.5 seconds should not produce "-60s"', () => {
    const result = formatTimeDelta(-59.5);
    expect(result).not.toBe('-60s');
    expect(result).toBe('-1:00');
  });

  it('NaN returns null', () => {
    expect(formatTimeDelta(NaN)).toBeNull();
  });

  it('Infinity returns null', () => {
    expect(formatTimeDelta(Infinity)).toBeNull();
  });
});

// ============================================================
// NaN/Infinity WALL — systematic invalid input coverage
// Every numeric format function must never leak banned strings
// ============================================================

describe('NaN/Infinity wall', () => {
  const INVALID_INPUTS = [NaN, Infinity, -Infinity];
  const BANNED_STRINGS = ['NaN', 'Infinity', '-Infinity', 'undefined', 'null'];

  // Functions that accept a single number and return a string
  const stringFormatters: [string, (v: number) => string][] = [
    ['formatDistance', (v) => formatDistance(v)],
    ['formatDistance (imperial)', (v) => formatDistance(v, false)],
    ['formatDuration', (v) => formatDuration(v)],
    ['formatDurationHuman', (v) => formatDurationHuman(v)],
    ['formatPace', (v) => formatPace(v)],
    ['formatPace (imperial)', (v) => formatPace(v, false)],
    ['formatPaceCompact', (v) => formatPaceCompact(v)],
    ['formatPaceCompact (imperial)', (v) => formatPaceCompact(v, false)],
    ['formatSwimPace', (v) => formatSwimPace(v)],
    ['formatSwimPace (imperial)', (v) => formatSwimPace(v, false)],
    ['formatSpeed', (v) => formatSpeed(v)],
    ['formatSpeed (imperial)', (v) => formatSpeed(v, false)],
    ['formatElevation', (v) => formatElevation(v)],
    ['formatElevation (imperial)', (v) => formatElevation(v, false)],
    ['formatTemperature', (v) => formatTemperature(v)],
    ['formatTemperature (imperial)', (v) => formatTemperature(v, false)],
    ['formatHeartRate', (v) => formatHeartRate(v)],
    ['formatPower', (v) => formatPower(v)],
    ['formatTSS', (v) => formatTSS(v)],
    ['formatCalories', (v) => formatCalories(v)],
    ['formatFileSize', (v) => formatFileSize(v)],
  ];

  // speedToSecsPerKm returns a number — coerce to string for banned-string check
  const numericFormatters: [string, (v: number) => number][] = [
    ['speedToSecsPerKm', (v) => speedToSecsPerKm(v)],
  ];

  // formatTimeDelta returns string | null — null is a valid "nothing to display"
  // sentinel, not a leaked value. Check non-null results only.
  const nullableFormatters: [string, (v: number) => string | null][] = [
    ['formatTimeDelta', (v) => formatTimeDelta(v)],
  ];

  stringFormatters.forEach(([name, fn]) => {
    describe(name, () => {
      INVALID_INPUTS.forEach((input) => {
        it(`does not produce banned string for ${input}`, () => {
          const result = fn(input);
          BANNED_STRINGS.forEach((banned) => {
            expect(result).not.toContain(banned);
          });
        });
      });

      it('does not produce banned string for undefined', () => {
        const result = fn(undefined as unknown as number);
        BANNED_STRINGS.forEach((banned) => {
          expect(result).not.toContain(banned);
        });
      });

      it('does not produce banned string for null', () => {
        const result = fn(null as unknown as number);
        BANNED_STRINGS.forEach((banned) => {
          expect(result).not.toContain(banned);
        });
      });
    });
  });

  numericFormatters.forEach(([name, fn]) => {
    describe(name, () => {
      INVALID_INPUTS.forEach((input) => {
        it(`does not produce banned string for ${input}`, () => {
          const result = String(fn(input));
          BANNED_STRINGS.forEach((banned) => {
            expect(result).not.toContain(banned);
          });
        });
      });

      it('does not produce banned string for undefined', () => {
        const result = String(fn(undefined as unknown as number));
        BANNED_STRINGS.forEach((banned) => {
          expect(result).not.toContain(banned);
        });
      });

      it('does not produce banned string for null', () => {
        const result = String(fn(null as unknown as number));
        BANNED_STRINGS.forEach((banned) => {
          expect(result).not.toContain(banned);
        });
      });
    });
  });

  nullableFormatters.forEach(([name, fn]) => {
    describe(name, () => {
      INVALID_INPUTS.forEach((input) => {
        it(`returns null or clean string for ${input}`, () => {
          const result = fn(input);
          if (result !== null) {
            BANNED_STRINGS.forEach((banned) => {
              expect(result).not.toContain(banned);
            });
          }
        });
      });

      it('returns null or clean string for undefined', () => {
        const result = fn(undefined as unknown as number);
        if (result !== null) {
          BANNED_STRINGS.forEach((banned) => {
            expect(result).not.toContain(banned);
          });
        }
      });

      it('returns null or clean string for null', () => {
        const result = fn(null as unknown as number);
        if (result !== null) {
          BANNED_STRINGS.forEach((banned) => {
            expect(result).not.toContain(banned);
          });
        }
      });
    });
  });
});

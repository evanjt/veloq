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
} from '@/shared/format/format';

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

// ============================================================
// Specific-value fallback matrix — each formatter's canonical
// fallback for NaN/Infinity/-Infinity/negative/null/undefined.
// The "NaN/Infinity wall" below also checks these but only asserts
// "no banned string". The matrix additionally locks the fallback value.
// ============================================================

// Formatters that reject negative numbers (distance/duration/pace/power/etc.
// can never be negative in the real world).
describe.each([
  { name: 'formatDuration', fn: (v: unknown) => formatDuration(v as number), fallback: '0:00' },
  { name: 'formatDistance', fn: (v: unknown) => formatDistance(v as number), fallback: '0 m' },
  { name: 'formatPace', fn: (v: unknown) => formatPace(v as number), fallback: '--:--' },
  { name: 'formatSpeed', fn: (v: unknown) => formatSpeed(v as number), fallback: '0.0 km/h' },
  { name: 'formatPower', fn: (v: unknown) => formatPower(v as number), fallback: '0 W' },
  { name: 'formatHeartRate', fn: (v: unknown) => formatHeartRate(v as number), fallback: '0 bpm' },
  { name: 'formatCalories', fn: (v: unknown) => formatCalories(v as number), fallback: '0 cal' },
  { name: 'formatTSS', fn: (v: unknown) => formatTSS(v as number), fallback: '0 TSS' },
])('$name invalid-input fallback', ({ fn, fallback }) => {
  it.each([NaN, Infinity, -Infinity, -1, null, undefined])('returns %p → fallback', (input) => {
    expect(fn(input)).toBe(fallback);
  });
});

// Elevation and temperature accept legitimately-negative values (below sea
// level, below freezing), so only NaN/Infinity/null/undefined fall back.
describe.each([
  {
    name: 'formatElevation',
    fn: (v: unknown) => formatElevation(v as number | null),
    fallback: '0 m',
  },
  {
    name: 'formatTemperature',
    fn: (v: unknown) => formatTemperature(v as number | null),
    fallback: '--°C',
  },
])('$name invalid-input fallback', ({ fn, fallback }) => {
  it.each([NaN, Infinity, -Infinity, null, undefined])('returns %p → fallback', (input) => {
    expect(fn(input)).toBe(fallback);
  });
});

// Zero is a valid value for distance/duration/elevation (displays as
// normal "0 m" / "0:00"), but a placeholder for pace/speed/temperature
// where zero is meaningless. Split out to preserve that distinction.
describe('zero-input handling', () => {
  it.each([
    ['formatDuration', formatDuration, 0, '0:00'],
    ['formatDistance', formatDistance, 0, '0 m'],
    ['formatFileSize', formatFileSize, 0, '0 B'],
    ['formatPace', formatPace, 0, '--:--'],
    ['speedToSecsPerKm', (v: number) => String(speedToSecsPerKm(v)), 0, '0'],
  ] as const)('%s(0) returns %p', (_, fn, input, expected) => {
    expect(fn(input as never)).toBe(expected);
  });
});

// Imperial variants: just confirm they also fall back cleanly on invalid input.
describe('imperial fallbacks', () => {
  it('formatDistance(NaN, false) returns 0 ft', () => {
    expect(formatDistance(NaN, false)).toBe('0 ft');
  });
});

/**
 * BUG: formatFileSize does not guard against NaN, Infinity, or negative values.
 * Every other format function guards these; formatFileSize was missed.
 * We keep behavioural checks (no banned output) separate from the matrix above
 * because formatFileSize produces unit-scaled output, not a fixed fallback.
 */
describe('formatFileSize edge cases', () => {
  it.each([
    [NaN, /NaN/],
    [Infinity, /Infinity/],
    [-1, /-/],
  ] as const)('%p does not leak %p', (input, banned) => {
    expect(formatFileSize(input)).not.toMatch(banned);
  });
});

/**
 * speedToSecsPerKm must coerce invalid input to 0 (avoid NaN propagation).
 */
describe('speedToSecsPerKm invalid-input coercion', () => {
  it.each([NaN, Infinity, -5])('coerces %p to 0', (input) => {
    const result = speedToSecsPerKm(input);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });
});

/**
 * formatTimeDelta:
 *  - Near-60-second boundary: 59.5 must roll over to ±1:00, not show ±60s.
 *  - NaN/Infinity return null (a valid "nothing to display" sentinel).
 */
describe('formatTimeDelta edge cases', () => {
  it.each([
    [59.5, '+1:00'],
    [-59.5, '-1:00'],
  ])('boundary %p rolls over to %p', (input, expected) => {
    expect(formatTimeDelta(input)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity])('invalid input %p returns null', (input) => {
    expect(formatTimeDelta(input)).toBeNull();
  });
});

/**
 * BUG: formatDurationHuman(59.5) returned "60s" instead of "1m" — the "< 60"
 * branch ran before rounding. Locked here so the fix stays in place.
 */
describe('formatDurationHuman boundary', () => {
  it('59.5 seconds rolls over to 1m', () => {
    expect(formatDurationHuman(59.5)).toMatch(/^1m$/);
  });
});

/**
 * formatSpeed must tolerate undefined cast to number without throwing.
 * Pre-existing coverage for NaN/Infinity/negative already lives in the
 * fallback matrix above.
 */
describe('formatSpeed defensive input', () => {
  it('does not throw on undefined cast to number', () => {
    expect(() => formatSpeed(undefined as unknown as number)).not.toThrow();
  });
});

// ============================================================
// NaN/Infinity WALL — systematic invalid input coverage
// Every numeric format function must never leak banned strings
// ============================================================

describe('NaN/Infinity wall', () => {
  // Every numeric formatter must never leak a banned token for ANY invalid input.
  // One case per formatter (looping the inputs inside) exercises the full
  // input × formatter matrix without one assertion per row.
  const INVALID_INPUTS = [NaN, Infinity, -Infinity, undefined, null];
  const BANNED_STRINGS = ['NaN', 'Infinity', '-Infinity', 'undefined', 'null'];

  const expectClean = (result: string) => {
    BANNED_STRINGS.forEach((banned) => expect(result).not.toContain(banned));
  };

  // Functions that accept a single number and return a string.
  it.each([
    ['formatDistance', (v: number) => formatDistance(v)],
    ['formatDistance (imperial)', (v: number) => formatDistance(v, false)],
    ['formatDuration', (v: number) => formatDuration(v)],
    ['formatDurationHuman', (v: number) => formatDurationHuman(v)],
    ['formatPace', (v: number) => formatPace(v)],
    ['formatPace (imperial)', (v: number) => formatPace(v, false)],
    ['formatPaceCompact', (v: number) => formatPaceCompact(v)],
    ['formatPaceCompact (imperial)', (v: number) => formatPaceCompact(v, false)],
    ['formatSwimPace', (v: number) => formatSwimPace(v)],
    ['formatSwimPace (imperial)', (v: number) => formatSwimPace(v, false)],
    ['formatSpeed', (v: number) => formatSpeed(v)],
    ['formatSpeed (imperial)', (v: number) => formatSpeed(v, false)],
    ['formatElevation', (v: number) => formatElevation(v)],
    ['formatElevation (imperial)', (v: number) => formatElevation(v, false)],
    ['formatTemperature', (v: number) => formatTemperature(v)],
    ['formatTemperature (imperial)', (v: number) => formatTemperature(v, false)],
    ['formatHeartRate', (v: number) => formatHeartRate(v)],
    ['formatPower', (v: number) => formatPower(v)],
    ['formatTSS', (v: number) => formatTSS(v)],
    ['formatCalories', (v: number) => formatCalories(v)],
    ['formatFileSize', (v: number) => formatFileSize(v)],
  ])('%s never leaks a banned token for any invalid input', (_name, fn) => {
    INVALID_INPUTS.forEach((input) => expectClean(fn(input as unknown as number)));
  });

  // speedToSecsPerKm returns a number — coerce to string for the banned-token check.
  it('speedToSecsPerKm never leaks a banned token for any invalid input', () => {
    INVALID_INPUTS.forEach((input) =>
      expectClean(String(speedToSecsPerKm(input as unknown as number)))
    );
  });

  // formatTimeDelta returns string | null — null is a valid "nothing to display"
  // sentinel, so only non-null results are checked.
  it('formatTimeDelta returns null or a clean string for any invalid input', () => {
    INVALID_INPUTS.forEach((input) => {
      const result = formatTimeDelta(input as unknown as number);
      if (result !== null) expectClean(result);
    });
  });
});

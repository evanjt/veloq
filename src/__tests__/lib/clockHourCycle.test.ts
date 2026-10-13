/**
 * Scenario: the 12 or 24-hour clock is a system setting separate from the
 * language, so an en-US phone can run 24-hour time and an en-AU one 12-hour.
 *
 * Expected behaviour: every time the app prints follows the system setting,
 * keeps the language's own wording around it, follows a change made while the
 * app was in the background, and falls back to the language's default when the
 * platform does not say.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { getCalendars } from 'expo-localization';

import { formatClockOrDate, formatDateTime } from '@/shared/format/format';

let mockLanguage = 'en-US';
jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  getCurrentLanguage: () => mockLanguage,
}));

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }]),
  getCalendars: jest.fn(),
}));

let appStateListener: ((state: AppStateStatus) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
  appStateListener = listener as (state: AppStateStatus) => void;
  return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
});

const setSystemClock = (uses24hourClock: boolean | null) => {
  (getCalendars as jest.Mock).mockReturnValue([
    { calendar: 'gregorian', uses24hourClock, firstWeekday: 2, timeZone: null },
  ]);
};

const foreground = () => appStateListener?.('active');

const evening = new Date(2026, 9, 10, 19, 30);
const afternoon = new Date(2026, 9, 10, 16, 30);
const midnight = new Date(2026, 9, 10, 0, 5);

describe('clock times follow the system 12 or 24-hour setting', () => {
  beforeEach(() => {
    mockLanguage = 'en-US';
    setSystemClock(null);
    foreground();
  });

  it('prints 24-hour time for an en-US language on a 24-hour phone', () => {
    setSystemClock(true);
    foreground();
    const clock = formatClockOrDate(evening.getTime(), evening);
    expect(clock).toBe('19:30');
    expect(formatDateTime(evening.toISOString())).toContain('19:30');
    expect(formatDateTime(evening.toISOString())).not.toMatch(/PM/i);
  });

  it('prints 12-hour time for an en-AU language on a 12-hour phone', () => {
    mockLanguage = 'en-AU';
    setSystemClock(false);
    foreground();
    expect(formatClockOrDate(afternoon.getTime(), afternoon)).toBe('4:30 pm');
    expect(formatDateTime(afternoon.toISOString())).toContain('4:30 pm');
  });

  it('prints 12-hour time for a de-DE language on a 12-hour phone', () => {
    mockLanguage = 'de-DE';
    setSystemClock(false);
    foreground();
    const clock = formatClockOrDate(afternoon.getTime(), afternoon);
    expect(clock).not.toContain('16');
    expect(clock).toMatch(/^4:30\s/);
  });

  it('prints midnight as 00 rather than 24 on a 24-hour phone', () => {
    setSystemClock(true);
    foreground();
    expect(formatClockOrDate(midnight.getTime(), midnight)).toBe('00:05');
  });

  it('keeps the language default when the platform does not say', () => {
    mockLanguage = 'en-AU';
    setSystemClock(null);
    foreground();
    expect(formatClockOrDate(afternoon.getTime(), afternoon)).toBe('4:30 pm');
    mockLanguage = 'de-DE';
    expect(formatClockOrDate(afternoon.getTime(), afternoon)).toBe('16:30');
  });

  it('follows a change made while the app was in the background', () => {
    setSystemClock(false);
    foreground();
    expect(formatClockOrDate(evening.getTime(), evening)).toBe('7:30 PM');
    setSystemClock(true);
    expect(formatClockOrDate(evening.getTime(), evening)).toBe('7:30 PM');
    foreground();
    expect(formatClockOrDate(evening.getTime(), evening)).toBe('19:30');
  });

  it('formats an epoch instant the same as its ISO string', () => {
    setSystemClock(true);
    foreground();
    expect(formatDateTime(evening.getTime())).toBe(formatDateTime(evening.toISOString()));
  });
});

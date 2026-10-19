/**
 * Scenario: a card's date line names the span its attempts cover in a fraction of the width two
 * labelled dates took, so the line fits beside the scope on a phone at Half.
 */

import { initialiseI18n } from '@/i18n';
import { formatDateSpan, formatFullDate } from '@/shared/format/format';
import { wallClockSecondsToLocalDate } from '@/shared/time/startDate';

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

describe('a date span', () => {
  it('writes the year once when both dates fall in it', () => {
    expect(formatDateSpan(new Date(2026, 6, 22), new Date(2026, 9, 3))).toBe(
      '22 July – 3 Oct 2026'
    );
  });

  it('writes both years when the span crosses one', () => {
    expect(formatDateSpan(new Date(2025, 11, 3), new Date(2026, 0, 4))).toBe(
      '3 Dec 2025 – 4 Jan 2026'
    );
  });

  it('writes one date when both are the same day', () => {
    const day = new Date(2026, 9, 3);
    expect(formatDateSpan(day, new Date(2026, 9, 3, 18, 30))).toBe(formatFullDate(day));
  });

  it('writes the date it has when the other is missing', () => {
    expect(formatDateSpan(null, new Date(2026, 9, 3))).toBe('3 Oct 2026');
    expect(formatDateSpan(new Date(2026, 6, 22), null)).toBe('22 July 2026');
  });

  it('is empty with neither date', () => {
    expect(formatDateSpan(null, null)).toBe('');
  });
});

describe('a date span of engine-dated attempts', () => {
  /** 00:00 on 15 Jan 2024 and 23:30 on 28 May 2026, each the athlete's wall clock stamped as UTC. */
  const FIRST_RIDE = Date.UTC(2024, 0, 15, 0, 0) / 1000;
  const LAST_RIDE = Date.UTC(2026, 4, 28, 23, 30) / 1000;

  it('names the days the attempts were ridden on, whatever zone the device is in', () => {
    expect(
      formatDateSpan(
        wallClockSecondsToLocalDate(FIRST_RIDE),
        wallClockSecondsToLocalDate(LAST_RIDE)
      )
    ).toBe('15 Jan 2024 – 28 May 2026');
  });

  it('keeps two rides on one day as one date', () => {
    const morning = Date.UTC(2026, 4, 28, 0, 15) / 1000;
    expect(
      formatDateSpan(wallClockSecondsToLocalDate(morning), wallClockSecondsToLocalDate(LAST_RIDE))
    ).toBe('28 May 2026');
  });
});

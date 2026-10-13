/**
 * Scenario: axis and chart dates built their own order and an apostrophe year,
 * and feed cards named the day with no time.
 *
 * Expected behaviour: every date reads in the app language's own order and year
 * form, and a card subtitle carries the start time beside the relative day.
 */

import { changeLanguage, initialiseI18n } from '@/i18n';
import {
  formatAxisDate,
  formatDateTime,
  formatRelativeDateTime,
  formatShortDateWithYear,
} from '@/shared/format/format';

const MID_JANUARY = new Date(2024, 0, 15, 12, 0);

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

afterEach(async () => {
  jest.useRealTimers();
  await changeLanguage('en-GB');
});

describe('axis dates under French', () => {
  beforeEach(async () => {
    await changeLanguage('fr');
  });

  it('puts the day where French puts it, with no apostrophe year', () => {
    const label = formatAxisDate(MID_JANUARY, true);
    expect(label).toBe(
      new Intl.DateTimeFormat('fr', { month: 'short', day: 'numeric', year: '2-digit' }).format(
        MID_JANUARY
      )
    );
    expect(label).not.toContain("'");
    expect(label.indexOf('15')).toBeLessThan(label.indexOf('janv'));
  });

  it('reads month and year alone when the axis does not need the day', () => {
    const label = formatAxisDate(MID_JANUARY, false);
    expect(label).toBe(
      new Intl.DateTimeFormat('fr', { month: 'short', year: 'numeric' }).format(MID_JANUARY)
    );
    expect(label).not.toContain('15');
    expect(label).not.toContain("'");
  });

  it('reads a tooltip day in the same order as the axis beside it', () => {
    expect(formatShortDateWithYear(MID_JANUARY)).toBe(formatAxisDate(MID_JANUARY, true));
  });
});

describe('axis dates carry the year across a boundary', () => {
  it('reads a month tick with its full year, so the year cannot pass for a day', () => {
    expect(formatAxisDate(MID_JANUARY, false)).toBe('Jan 2024');
  });

  it('names the year on each side of new year', () => {
    expect(formatAxisDate(new Date(2023, 11, 31, 12), false)).toContain('2023');
    expect(formatAxisDate(new Date(2024, 0, 1, 12), false)).toContain('2024');
    expect(formatShortDateWithYear(new Date(2023, 11, 31, 12))).toContain('23');
  });
});

describe('formatRelativeDateTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2024, 5, 15, 18, 0));
  });

  it('reads today with the start time', () => {
    expect(formatRelativeDateTime('2024-06-15T07:12:00')).toBe('Today, 07:12');
  });

  it('tells two rides on one day apart', () => {
    expect(formatRelativeDateTime('2024-06-15T07:12:00')).not.toBe(
      formatRelativeDateTime('2024-06-15T17:40:00')
    );
  });

  it('reads yesterday with the start time', () => {
    expect(formatRelativeDateTime('2024-06-14T21:05:00')).toBe('Yesterday, 21:05');
  });

  it('carries the time on a weekday within the week', () => {
    expect(formatRelativeDateTime('2024-06-12T09:30:00')).toBe('Wednesday, 09:30');
  });

  it('carries the year and the time on an earlier year', () => {
    const label = formatRelativeDateTime('2023-03-04T06:45:00');
    expect(label).toContain('2023');
    expect(label).toContain('06:45');
  });

  it('follows the app language', async () => {
    await changeLanguage('fr');
    expect(formatRelativeDateTime('2024-06-15T07:12:00')).toBe("Aujourd'hui, 07:12");
  });

  it('reads a day string with no time as the day alone', () => {
    expect(formatRelativeDateTime('2024-06-15')).toBe('Today');
  });
});

describe('formatDateTime', () => {
  it('leaves the seconds out', () => {
    const label = formatDateTime('2024-06-15T07:12:34');
    expect(label).toContain('07:12');
    expect(label).not.toContain('34');
  });
});

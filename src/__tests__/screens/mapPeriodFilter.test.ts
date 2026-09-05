/**
 * Scenario: the map tab filters activities by period, on a tab that ships in
 * seventeen locales, and its month arithmetic was the only calendar-based
 * arithmetic in the app while every other surface counts days.
 *
 * Expected behaviour: every label is a translation key, and a month on the map
 * is the same span as a month on the fitness tab. `all` and `year` are the two
 * that are deliberately not spans: `all` reaches back past any library, and
 * `year` is the calendar year to date, which is why it keeps a label of its own
 * rather than reading as the `1Y` that means 365 days elsewhere.
 */

import { PERIOD_OPTIONS, PERIOD_DAYS, getPeriodStart } from '@/features/maps/lib/mapPeriod';
import { RANGE_DAYS } from '@/features/routes/constants';
import en from '@/i18n/locales/en-GB.json';

const DAY_MS = 86_400_000;

function labelFor(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), en);
}

describe('the map period picker', () => {
  it('names every option through i18n', () => {
    expect(PERIOD_OPTIONS).toHaveLength(6);
    for (const option of PERIOD_OPTIONS) {
      expect(option.labelKey).toMatch(/^maps\./);
      expect(typeof labelFor(option.labelKey)).toBe('string');
    }
  });

  it('counts a month the way the rest of the app counts one', () => {
    expect(PERIOD_DAYS['1m']).toBe(RANGE_DAYS['1m']);
    expect(PERIOD_DAYS['3m']).toBe(RANGE_DAYS['3m']);
    expect(PERIOD_DAYS['6m']).toBe(RANGE_DAYS['6m']);
    expect(PERIOD_DAYS['1w']).toBe(7);
  });

  it.each([
    ['2026-01-31T12:00:00Z', '1m'],
    ['2026-03-31T12:00:00Z', '1m'],
    ['2024-02-29T12:00:00Z', '1m'],
    ['2026-05-15T12:00:00Z', '3m'],
    ['2026-05-15T12:00:00Z', '6m'],
    ['2026-05-15T12:00:00Z', '1w'],
  ])('starts %s minus %s exactly that many days back', (now, period) => {
    const at = new Date(now);
    const start = getPeriodStart(period as keyof typeof PERIOD_DAYS, at);
    const days = Math.round((at.getTime() - start.getTime()) / DAY_MS);

    expect(days).toBe(PERIOD_DAYS[period as keyof typeof PERIOD_DAYS]);
  });

  it('does not overflow a month the way setMonth does on the 31st', () => {
    // `new Date('2026-01-31').setMonth(0 - 1)` lands in March, so the filter
    // that reads "1 mo" would have covered the month ahead of the athlete.
    const start = getPeriodStart('1m', new Date('2026-01-31T12:00:00Z'));

    expect(start.getTime()).toBeLessThan(new Date('2026-01-31T12:00:00Z').getTime());
    expect(start.getUTCMonth()).toBe(0);
  });

  it('keeps `year` as the calendar year to date, which is not a span', () => {
    const start = getPeriodStart('year', new Date('2026-01-02T12:00:00Z'));

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(PERIOD_DAYS).not.toHaveProperty('year');
  });

  it('reaches back past any library for `all`', () => {
    const start = getPeriodStart('all', new Date('2026-05-15T12:00:00Z'));

    expect(start.getFullYear()).toBeLessThanOrEqual(2000);
  });
});

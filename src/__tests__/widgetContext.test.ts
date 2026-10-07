/**
 * Scenario: the engine writes the widget snapshot, in the app and in the push
 * worker with no JavaScript alive, from a context the app hands over.
 *
 * Expected behaviour: the context carries every word in the app's language and
 * the locale's own date order, so a snapshot the worker writes reads the same
 * as one the app writes.
 */

import {
  composeWidgetContext,
  WIDGET_STRING_KEYS,
  widgetDateWords,
} from '@/features/home/lib/widgetSnapshot';

const NO_DATES = {
  weekdays: [],
  monthDay: { parts: [], months: [] },
  monthDayYear: { parts: [], months: [] },
};

describe('the words the engine writes', () => {
  it('are every key the composer translates, in the app language', () => {
    const context = composeWidgetContext({
      locale: 'de-DE',
      isMetric: true,
      dates: NO_DATES,
      translate: (key) => `de:${key}`,
    });

    expect(Object.keys(context.strings)).toEqual([...WIDGET_STRING_KEYS]);
    expect(context.strings['fitnessScreen.perWeek']).toBe('de:fitnessScreen.perWeek');
  });

  it('fall back to the key with no translator, as i18next does for a missing one', () => {
    const context = composeWidgetContext({ locale: 'en-AU', isMetric: true, dates: NO_DATES });

    expect(context.strings['metrics.form']).toBe('metrics.form');
  });

  it('carry the settings the summary card and the units follow', () => {
    const summaryPrefs = {
      enabled: true,
      heroMetric: 'hrv' as const,
      showSparkline: false,
      supportingMetrics: ['ftp' as const],
    };
    const context = composeWidgetContext({
      locale: 'en-US',
      isMetric: false,
      formAsPercent: true,
      summaryPrefs,
      dates: NO_DATES,
    });

    expect(context.isMetric).toBe(false);
    expect(context.formAsPercent).toBe(true);
    expect(context.summaryCard).toEqual(summaryPrefs);
    expect(context.activityTints.Other).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('hide the summary block when there are no settings to follow', () => {
    expect(
      composeWidgetContext({ locale: 'en-AU', isMetric: true, dates: NO_DATES }).summaryCard
    ).toBeNull();
  });
});

describe('the date words', () => {
  it('name the week Sunday first', () => {
    const words = widgetDateWords('en-AU');

    expect(words.weekdays).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
  });

  it('write a short date in the order the locale writes it', () => {
    const order = (locale: string) =>
      widgetDateWords(locale).monthDay.parts.map((p) => (p.type === 'literal' ? p.value : p.type));

    expect(order('en-US')).toEqual(['month', ' ', 'day']);
    expect(order('en-AU')).toEqual(['day', ' ', 'month']);
  });

  it('carry the month names the format writes, January first', () => {
    const { months } = widgetDateWords('en-US').monthDay;

    expect(months).toHaveLength(12);
    expect(months[0]).toBe('Jan');
    expect(months[11]).toBe('Dec');
  });

  it('put the year where the locale puts it', () => {
    const parts = widgetDateWords('en-US').monthDayYear.parts.map((p) => p.type);

    expect(parts.filter((t) => t !== 'literal')).toEqual(['month', 'day', 'year']);
  });
});

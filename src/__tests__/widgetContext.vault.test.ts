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
  widgetNumberWords,
} from '@/features/home/lib/widgetSnapshot';
import type { Insight, InsightCategory } from '@/features/insights';

const NO_DATES = {
  weekdays: [],
  monthDay: { parts: [], months: [] },
  monthDayYear: { parts: [], months: [] },
  months: [],
};

describe('the words the engine writes', () => {
  it('are every key the composer translates, in the app language', () => {
    const context = composeWidgetContext({
      locale: 'de-DE',
      isMetric: true,
      dates: NO_DATES,
      translate: (key) => `de:${key}`,
    });

    expect([...context.strings.keys()]).toEqual([...WIDGET_STRING_KEYS]);
    expect(context.strings.get('fitnessScreen.perWeek')).toBe('de:fitnessScreen.perWeek');
  });

  it('fall back to the key with no translator, as i18next does for a missing one', () => {
    const context = composeWidgetContext({ locale: 'en-AU', isMetric: true, dates: NO_DATES });

    expect(context.strings.get('metrics.form')).toBe('metrics.form');
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
  });

  it('hide the summary block when there are no settings to follow', () => {
    expect(
      composeWidgetContext({ locale: 'en-AU', isMetric: true, dates: NO_DATES }).summaryCard
    ).toBeUndefined();
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

  it('carry the long month names a label writes alone, which the strength month is called by', () => {
    expect(widgetDateWords('en-US').months).toHaveLength(12);
    expect(widgetDateWords('en-US').months[9]).toBe('October');
    // Alone, not inside a date: Polish names the month in the nominative.
    expect(widgetDateWords('pl').months[9]).toBe('październik');
  });

  it('put the year where the locale puts it', () => {
    const parts = widgetDateWords('en-US').monthDayYear.parts.map((p) => p.type);

    expect(parts.filter((t) => t !== 'literal')).toEqual(['month', 'day', 'year']);
  });
});

describe('the number separators', () => {
  it('are the locale decimal and group marks', () => {
    expect(widgetNumberWords('de-DE')).toEqual({
      decimal: ',',
      group: '.',
      minimumGroupingDigits: 1,
    });
    expect(widgetNumberWords('en-AU')).toEqual({
      decimal: '.',
      group: ',',
      minimumGroupingDigits: 1,
    });
  });

  it('leave a four digit number ungrouped where the locale does', () => {
    expect(widgetNumberWords('es-ES').minimumGroupingDigits).toBe(2);
  });

  it('are carried in the context the engine composes with', () => {
    const numbers = { decimal: ',', group: '.', minimumGroupingDigits: 1 };
    const context = composeWidgetContext({
      locale: 'de-DE',
      isMetric: true,
      dates: NO_DATES,
      numbers,
    });

    expect(context.numbers).toEqual(numbers);
  });
});

describe('the insights the widget lists', () => {
  const insight = (id: string, category: InsightCategory, navigationTarget?: string): Insight => ({
    id,
    category,
    priority: 3,
    title: `title ${id}`,
    line: `line ${id}`,
    subtitle: `subtitle ${id}`,
    icon: 'trending-up',
    iconTone: 'positive',
    navigationTarget,
    timestamp: 0,
    isNew: false,
  });

  const ranked = [
    insight('a', 'section_pr', '/section/s1'),
    insight('b', 'hrv_trend', '/fitness?range=3m'),
    insight('c', 'route', '/route/r1'),
    insight('d', 'period_comparison'),
    insight('e', 'stale_pr', '/section/s2'),
  ];

  const compose = (insights: Insight[] = ranked) =>
    composeWidgetContext({ locale: 'en-AU', isMetric: true, dates: NO_DATES, insights }).insights;

  it('keep the order the Insights tab ranks them in, with each deep link', () => {
    expect(compose().map((i) => [i.id, i.url])).toEqual([
      ['a', 'veloq://section/s1'],
      ['b', 'veloq://fitness?range=3m'],
      ['c', 'veloq://route/r1'],
      ['d', 'veloq://insights'],
      ['e', 'veloq://section/s2'],
    ]);
  });

  it('are all of the tab list, since each placed widget filters the kinds for itself', () => {
    expect(compose().map((i) => i.category)).toEqual([
      'section_pr',
      'hrv_trend',
      'route',
      'period_comparison',
      'stale_pr',
    ]);
  });

  it('carry what a row draws and nothing more', () => {
    expect(compose()[0]).toEqual({
      id: 'a',
      category: 'section_pr',
      title: 'title a',
      subtitle: 'subtitle a',
      icon: 'trending-up',
      tone: 'positive',
      url: 'veloq://section/s1',
    });
  });

  it('are empty with no ranked insights', () => {
    expect(compose([])).toEqual([]);
  });
});

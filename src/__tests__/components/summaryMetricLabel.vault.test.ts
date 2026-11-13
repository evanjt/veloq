/**
 * Scenario: a summary card number beside an arrow is spoken as a sentence that
 * names the baseline. The screen reader adds the button role after the label,
 * so a label that ends in a full stop is read with a second pause before it.
 *
 * Expected behaviour: the spoken label of a judged number keeps its sentences
 * and drops the full stop that ends it.
 */

import { createInstance } from 'i18next';

import { summaryMetricLabel } from '@/features/home/lib/summaryCardTrendLabel';

import { resolvedLocale } from '../i18n/resolvedLocale';

async function translatorFor(locale: string) {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: resolvedLocale(locale) } },
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance);
}

describe('summaryMetricLabel', () => {
  it('ends a label that compares with an earlier day without a full stop', async () => {
    const t = await translatorFor('en-AU');
    const label = summaryMetricLabel(t, {
      name: 'Fitness',
      value: 23,
      metric: 'fitness',
      trend: '→',
      baseline: { kind: 'day', previous: 23, date: Date.UTC(2026, 9, 25) / 86_400_000 },
    });

    expect(label).toMatch(/^Fitness 23, steady\. Compared with 23 on /);
    expect(label.endsWith('.')).toBe(false);
  });

  it('ends a label that compares with the same point last week without a full stop', async () => {
    const t = await translatorFor('en-AU');
    const label = summaryMetricLabel(t, {
      name: 'Fitness',
      value: 23,
      metric: 'fitness',
      trend: '→',
      baseline: { kind: 'lastWeek', previous: 22 },
    });

    expect(label).toBe('Fitness 23, steady. Compared with 22 at this point last week');
  });
});

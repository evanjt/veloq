/**
 * Scenario: the pace sheet's summary sentence ended in a fixed metric unit
 * ("per km", "per 100m") in every locale, so values carrying an imperial unit
 * read "from 8:56 /mi to 8:30 /mi" followed by "per km".
 *
 * Expected behaviour: the summary names the unit of the data points it quotes,
 * and a yard swim pace still opens the swim sheet.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { changeLanguage, initializeI18n } from '@/i18n';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import type { Insight } from '@/types';

function textOf(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const { children } = node as { children?: unknown[] };
  return (children ?? []).flatMap(textOf);
}

function paceInsight(unit: string, previous: string, current: string): Insight {
  return {
    id: 'milestone',
    supportingData: {
      dataPoints: [
        { label: 'Now', value: current, unit },
        { label: 'Before', value: previous, unit },
        { label: 'Change', value: '-26', unit: `s${unit}`, context: 'good' },
      ],
    },
  } as unknown as Insight;
}

function summary(insight: Insight): string {
  return textOf(render(<FitnessMilestoneContent insight={insight} />).toJSON()).join(' ');
}

const LOCALES: Parameters<typeof initializeI18n>[0][] = [
  'da',
  'de-CH',
  'de-DE',
  'en-AU',
  'en-GB',
  'en-US',
  'es-419',
  'es-ES',
  'es',
  'fr',
  'it',
  'ja',
  'nl',
  'pl',
  'pt-BR',
  'pt',
  'zh-Hans',
];

describe('the pace milestone summary', () => {
  afterEach(async () => {
    await changeLanguage('en-AU');
  });

  it.each(LOCALES)('quotes a per mile unit and no kilometre unit in %s', async (locale) => {
    await initializeI18n(locale);
    const text = summary(paceInsight('/mi', '8:56', '8:30'));

    expect(text).toMatch(/8:56[^.]*\/mi[^.]*8:30[^.]*\/mi/);
    expect(text).not.toMatch(/\bkm\b|公里|キロ|1km/);
  });

  it.each(LOCALES)('quotes a per 100 yard unit and no metre unit in %s', async (locale) => {
    await initializeI18n(locale);
    const text = summary(paceInsight('/100yd', '1:52', '1:48'));

    expect(text).toMatch(/1:52[^.]*\/100yd[^.]*1:48[^.]*\/100yd/);
    expect(text).not.toMatch(/100m|100米/);
  });

  it('keeps the metric units for a metric athlete', async () => {
    await initializeI18n('en-AU');

    expect(summary(paceInsight('/km', '8:56', '8:30'))).toMatch(/8:30[^.]*\/km/);
    expect(summary(paceInsight('/100m', '1:52', '1:48'))).toMatch(/1:48[^.]*\/100m/);
  });
});

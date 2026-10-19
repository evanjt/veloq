/**
 * Scenario: each Insights sub-tab ends in a card that says how its cards or
 * rows are found, what each kind means and where the numbers come from, as
 * the Fitness tab ends in one for fitness, fatigue and form.
 *
 * Expected behaviour: the Insights card names every kind of insight the
 * pipeline can produce, so a kind added later cannot go unexplained, and every
 * line it reads is translated in every locale.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  INSIGHT_KIND,
  insightsExplanation,
  strengthExplanation,
} from '@/features/insights/lib/aboutCopy';
import { routesExplanation, sectionsExplanation } from '@/features/routes/lib/explanationCopy';
import { initialiseI18n, i18n } from '@/i18n';
import type { SupportedLocale } from '@/i18n/types';
import type { InsightCategory } from '@/types';
import type { ExplanationRow } from '@/shared/ui/ExplanationCard';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', '') as SupportedLocale);

/** Stands in for i18next: returns the key, then any values, so the composition is visible. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as unknown as Parameters<
  typeof insightsExplanation
>[0];

const ALL_CATEGORIES: InsightCategory[] = [
  'section_pr',
  'section_trend',
  'route',
  'stale_pr',
  'fitness_milestone',
  'period_comparison',
  'strength_progression',
  'strength_balance',
  'hrv_trend',
  'efficiency_trend',
  'section_changed',
];

const rowKeys = (rows: readonly ExplanationRow[]) => rows.map((row) => row.key);

describe('the Insights explanation', () => {
  const explanation = insightsExplanation(t);

  it('has a line for the kind every category is shown under', () => {
    for (const category of ALL_CATEGORIES) {
      expect(rowKeys(explanation.rows)).toContain(`kind:${INSIGHT_KIND[category]}`);
    }
  });

  it('labels each kind and says what it means', () => {
    for (const row of explanation.rows.filter((r) => r.key.startsWith('kind:'))) {
      const kind = row.key.slice('kind:'.length);
      expect(row.label).toBe(`insights.explanation.kinds.${kind}.label`);
      expect(row.text).toBe(`insights.explanation.kinds.${kind}.text`);
    }
  });

  it('says how insights are found first, and the disclaimer last', () => {
    expect(explanation.rows[0]).toEqual({
      key: 'found',
      label: 'insights.explanation.foundLabel',
      text: 'insights.explanation.found',
    });
    expect(explanation.rows.at(-1)).toEqual({ key: 'disclaimer', text: 'insights.aboutBody' });
  });

  it('says where the numbers come from, and leaves the ordering to the header', () => {
    const byKey = new Map(explanation.rows.map((row) => [row.key, row]));
    expect(byKey.has('order')).toBe(false);
    expect(explanation.rows.map((row) => row.text)).not.toContain('insights.aboutRanking');
    expect(byKey.get('sources')).toEqual({
      key: 'sources',
      label: 'insights.explanation.sourcesLabel',
      text: 'insights.explanation.sources:{"howCalculated":"insights.howCalculated"}',
    });
  });
});

describe('the Strength, Routes and Sections explanations', () => {
  it('Strength says how sets are weighted and where the data comes from', () => {
    const explanation = strengthExplanation(t);
    expect(explanation.title).toBe('insights.explanation.strengthTitle');
    expect(explanation.rows).toEqual([
      { key: 'weighting', text: 'strength.infoWeighting' },
      { key: 'sources', label: 'insights.explanation.sourcesLabel', text: 'strength.disclaimer' },
    ]);
  });

  it('Routes says what a route is and where its numbers come from', () => {
    const explanation = routesExplanation(t);
    expect(explanation.title).toBe('routes.explanation.routesTitle');
    expect(explanation.rows).toEqual([
      {
        key: 'what',
        label: 'routes.explanation.routesWhatLabel',
        text: 'routes.explanation.routesWhat',
      },
      {
        key: 'sources',
        label: 'insights.explanation.sourcesLabel',
        text: 'routes.explanation.routesSources',
      },
    ]);
  });

  it('Sections says what a section is and where its numbers come from', () => {
    const explanation = sectionsExplanation(t);
    expect(explanation.title).toBe('routes.explanation.sectionsTitle');
    expect(explanation.rows).toEqual([
      {
        key: 'what',
        label: 'routes.explanation.sectionsWhatLabel',
        text: 'routes.sectionsDescription',
      },
      {
        key: 'sources',
        label: 'insights.explanation.sourcesLabel',
        text: 'routes.explanation.sectionsSources',
      },
    ]);
  });
});

describe('the explanations in every locale', () => {
  it.each(locales)('%s reads every line as text, never as a key', async (locale) => {
    await initialiseI18n(locale);
    const real = i18n.t.bind(i18n) as unknown as typeof t;
    const explanations = [
      insightsExplanation(real),
      strengthExplanation(real),
      routesExplanation(real),
      sectionsExplanation(real),
    ];
    for (const explanation of explanations) {
      const lines = [
        explanation.title,
        ...explanation.rows.flatMap((row) => [row.label ?? 'x', row.text]),
      ];
      for (const line of lines) {
        expect(line).not.toMatch(/^(insights|routes|strength)\.[a-zA-Z.]+$/);
        expect(line).not.toContain('{{');
      }
    }
  });
});

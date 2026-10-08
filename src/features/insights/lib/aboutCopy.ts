/**
 * What the insights header's information button says, and the cards at the
 * foot of the Insights and Strength sub-tabs.
 *
 * There is one button and it sits above the tab strip, so it opens on all five
 * sub-tabs. The disclaimer belongs on every one of them. The ranking
 * explanation does not: Routes and Sections are ordered by their own engine
 * ranking and Strength by muscle group, so an explanation of the insight
 * ranking is simply wrong there.
 *
 * The copy names the signals and never the weights. The weights are tuned, and
 * a sentence that quotes one becomes a lie the first time it moves.
 */

import type { ParseKeys, TFunction } from 'i18next';

import type { Explanation, ExplanationRow } from '@/shared/ui/ExplanationCard';
import type { InsightCategory } from '../types';

/** The sub-tabs the header sits above. */
export type InsightsTab = 'insights' | 'strength' | 'routes' | 'sections' | 'debug';

export function aboutInsightsBody(t: TFunction, tab: InsightsTab): string {
  const body = t('insights.aboutBody') as string;
  if (tab !== 'insights') return body;
  return `${body}\n\n${t('insights.aboutRanking') as string}`;
}

/** The kinds the Insights card explains, each covering one or more categories. */
export type InsightKind =
  | 'sectionsAndRoutes'
  | 'fitness'
  | 'week'
  | 'hrv'
  | 'strength'
  | 'sectionChanges';

/** The kind each category is explained under, so no category goes unexplained. */
export const INSIGHT_KIND: Record<InsightCategory, InsightKind> = {
  section_pr: 'sectionsAndRoutes',
  section_trend: 'sectionsAndRoutes',
  route: 'sectionsAndRoutes',
  efficiency_trend: 'sectionsAndRoutes',
  fitness_milestone: 'fitness',
  stale_pr: 'fitness',
  period_comparison: 'week',
  hrv_trend: 'hrv',
  strength_progression: 'strength',
  strength_balance: 'strength',
  section_changed: 'sectionChanges',
};

/** The kinds in the order the card lists them, each with its keys written out in full. */
const KIND_COPY: readonly { kind: InsightKind; label: ParseKeys; text: ParseKeys }[] = [
  {
    kind: 'sectionsAndRoutes',
    label: 'insights.explanation.kinds.sectionsAndRoutes.label',
    text: 'insights.explanation.kinds.sectionsAndRoutes.text',
  },
  {
    kind: 'fitness',
    label: 'insights.explanation.kinds.fitness.label',
    text: 'insights.explanation.kinds.fitness.text',
  },
  {
    kind: 'week',
    label: 'insights.explanation.kinds.week.label',
    text: 'insights.explanation.kinds.week.text',
  },
  {
    kind: 'hrv',
    label: 'insights.explanation.kinds.hrv.label',
    text: 'insights.explanation.kinds.hrv.text',
  },
  {
    kind: 'strength',
    label: 'insights.explanation.kinds.strength.label',
    text: 'insights.explanation.kinds.strength.text',
  },
  {
    kind: 'sectionChanges',
    label: 'insights.explanation.kinds.sectionChanges.label',
    text: 'insights.explanation.kinds.sectionChanges.text',
  },
];

/** The card at the foot of the Insights sub-tab. */
export function insightsExplanation(t: TFunction): Explanation {
  const kinds: ExplanationRow[] = KIND_COPY.map(({ kind, label, text }) => ({
    key: `kind:${kind}`,
    label: t(label) as string,
    text: t(text) as string,
  }));
  return {
    title: t('insights.explanation.title') as string,
    rows: [
      {
        key: 'found',
        label: t('insights.explanation.foundLabel') as string,
        text: t('insights.explanation.found') as string,
      },
      ...kinds,
      {
        key: 'order',
        label: t('insights.explanation.orderLabel') as string,
        text: t('insights.aboutRanking') as string,
      },
      {
        key: 'sources',
        label: t('insights.explanation.sourcesLabel') as string,
        text: t('insights.explanation.sources', {
          howCalculated: t('insights.howCalculated') as string,
        }) as string,
      },
      { key: 'disclaimer', text: t('insights.aboutBody') as string },
    ],
  };
}

/** The card at the foot of the Strength sub-tab. */
export function strengthExplanation(t: TFunction): Explanation {
  return {
    title: t('insights.explanation.strengthTitle') as string,
    rows: [
      { key: 'weighting', text: t('strength.infoWeighting') as string },
      {
        key: 'sources',
        label: t('insights.explanation.sourcesLabel') as string,
        text: t('strength.disclaimer') as string,
      },
    ],
  };
}

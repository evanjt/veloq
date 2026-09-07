/**
 * What the insights header's information button says.
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

import type { TFunction } from 'i18next';

/** The sub-tabs the header sits above. */
export type InsightsTab = 'insights' | 'strength' | 'routes' | 'sections' | 'debug';

export function aboutInsightsBody(t: TFunction, tab: InsightsTab): string {
  const body = t('insights.aboutBody') as string;
  if (tab !== 'insights') return body;
  return `${body}\n\n${t('insights.aboutRanking') as string}`;
}

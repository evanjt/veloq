/**
 * What the cards at the foot of the Routes and Sections sub-tabs say: what a
 * route or a section is, and where its numbers come from.
 */

import type { TFunction } from 'i18next';

import type { Explanation } from '@/shared/ui/ExplanationCard';

export function routesExplanation(t: TFunction): Explanation {
  return {
    title: t('routes.explanation.routesTitle') as string,
    rows: [
      {
        key: 'what',
        label: t('routes.explanation.routesWhatLabel') as string,
        text: t('routes.explanation.routesWhat') as string,
      },
      {
        key: 'sources',
        label: t('insights.explanation.sourcesLabel') as string,
        text: t('routes.explanation.routesSources') as string,
      },
    ],
  };
}

export function sectionsExplanation(t: TFunction): Explanation {
  return {
    title: t('routes.explanation.sectionsTitle') as string,
    rows: [
      {
        key: 'what',
        label: t('routes.explanation.sectionsWhatLabel') as string,
        text: t('routes.sectionsDescription') as string,
      },
      {
        key: 'sources',
        label: t('insights.explanation.sourcesLabel') as string,
        text: t('routes.explanation.sectionsSources') as string,
      },
    ],
  };
}

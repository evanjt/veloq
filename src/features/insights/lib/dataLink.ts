import type { Insight, TFunc } from '../types';

/** What the card's graphic opens, when it pictures a screen rather than the sheet's rows. */
export function historyTarget(insight: Insight): string | undefined {
  const history = insight.supportingData?.history;
  return history && history.kind !== 'changes' ? history.target : undefined;
}

/**
 * The screen holding the data an insight was computed from, or null for a card
 * that carries none.
 *
 * What the graphic pictures comes first, since that is the series the numbers
 * were taken from: a record opens its section with the record's effort
 * highlighted, a fitness card the window it compared. A summary across
 * sections pictures its rows, so it opens the top-ranked one.
 */
export function insightDataTarget(insight: Insight): string | null {
  const pictured = historyTarget(insight);
  if (pictured) return pictured;
  if (insight.navigationTarget) return insight.navigationTarget;
  const top = insight.supportingData?.sections?.[0];
  return top ? `/section/${top.sectionId}` : null;
}

/** Where a link to an insight's data goes, named from the route it opens. */
export function dataLinkLabel(insight: Insight, target: string | undefined, t: TFunc): string {
  if (!target) return t('insights.graphic.openDetail');
  if (target.startsWith('/section/')) {
    const name = insight.meta?.placeName ?? insight.supportingData?.sections?.[0]?.sectionName;
    return name
      ? t('insights.graphic.openSection', { name })
      : t('insights.graphic.openTheSection');
  }
  if (target.startsWith('/fitness')) return t('insights.graphic.openFitness');
  if (target.startsWith('/insights?tab=strength')) return t('insights.graphic.openStrength');
  return t('insights.graphic.openDetail');
}

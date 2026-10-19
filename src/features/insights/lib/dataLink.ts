import type { Insight, TFunc } from '../types';

/** The screen a history was read from, unless it pictures the sheet's own rows. */
export function historyTarget(insight: Insight): string | undefined {
  const history = insight.supportingData?.history;
  return history && history.kind !== 'changes' ? history.target : undefined;
}

/**
 * The screen holding the data an insight was computed from, or null for a card
 * that carries none.
 *
 * The series the numbers were taken from comes first, whether or not it was
 * long enough to draw: a record opens its section with the record's effort
 * highlighted, a fitness card the window it compared. A summary across
 * sections pictures its rows, so it opens the top-ranked one.
 */
export function insightDataTarget(insight: Insight): string | null {
  const pictured = historyTarget(insight) ?? insight.supportingData?.dataTarget;
  if (pictured) return pictured;
  if (insight.navigationTarget) return insight.navigationTarget;
  const top = insight.supportingData?.sections?.[0];
  return top ? `/section/${top.sectionId}` : null;
}

/** The screen a target opens, without the parameters that place it on that screen. */
function screenOf(target: string): string {
  const query = target.indexOf('?');
  return query < 0 ? target : target.slice(0, query);
}

/**
 * Where the sheet's View in detail goes, or null when it would open the screen
 * the data link already opens. A sheet offers one control per destination, and
 * the data link, which can carry the effort to highlight, is that control.
 */
export function viewInDetailTarget(insight: Insight): string | null {
  const target = insight.navigationTarget;
  if (!target) return null;
  const data = insightDataTarget(insight);
  return data != null && screenOf(data) === screenOf(target) ? null : target;
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

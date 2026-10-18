import type { WidgetInsight } from 'veloqrs';
import type { Insight } from '../types';

/** Where a row opens when its insight names no target of its own: the Insights tab. */
const INSIGHTS_TAB_URL = 'veloq://insights';

/** One row of the insights widget, with the link it opens, as the engine's record declares it. */
export type { WidgetInsight };

/**
 * The Insights tab's own ranking as widget rows, in that order and of every kind.
 * Which kinds a placed widget lists, and how many rows its size shows, are decided
 * by that widget when it draws, since the same snapshot serves every placement.
 */
export function widgetInsights(ranked: readonly Insight[]): WidgetInsight[] {
  return ranked.map((insight) => ({
    id: insight.id,
    category: insight.category,
    title: insight.title,
    subtitle: insight.subtitle ?? '',
    icon: insight.icon,
    tone: insight.iconTone,
    url: insightUrl(insight.navigationTarget),
  }));
}

/** An in-app path (`/section/s1?x=1`) as the link the app registers for it. */
function insightUrl(target: string | undefined): string {
  if (!target || !target.startsWith('/')) return INSIGHTS_TAB_URL;
  return `veloq:/${target}`;
}

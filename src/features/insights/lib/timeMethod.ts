import type { Insight, InsightCategory } from '../types';

type TimeMethodKey = 'sections.timeMethod' | 'routes.timeMethod';

/**
 * The clock each category's sheet prints its times on. A section time is
 * elapsed over the portion, stops included; a route time is the activity's
 * moving time. Keyed on every category, so one added without a decision here
 * does not compile.
 */
const TIME_METHOD_BY_CATEGORY: Record<InsightCategory, TimeMethodKey | null> = {
  section_pr: 'sections.timeMethod',
  section_trend: 'sections.timeMethod',
  stale_pr: 'sections.timeMethod',
  route: 'routes.timeMethod',
  fitness_milestone: null,
  period_comparison: null,
  hrv_trend: null,
  efficiency_trend: null,
  strength_progression: null,
  strength_balance: null,
  section_changed: null,
};

/**
 * The line an insight's method states its times on, or null for a sheet that
 * prints none. A sheet listing sections with their best times prints section
 * times whatever its category.
 */
export function timeMethodKey(insight: Insight): TimeMethodKey | null {
  const byCategory = TIME_METHOD_BY_CATEGORY[insight.category];
  if (byCategory) return byCategory;
  const listsSectionTimes = insight.supportingData?.sections?.some((s) => s.bestTime != null);
  return listsSectionTimes ? 'sections.timeMethod' : null;
}

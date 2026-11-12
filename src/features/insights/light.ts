/**
 * What a module that must not load the Insights components needs: the types, and
 * the widget's pick from the ranked list. `scripts/lint-feature-imports.mjs`
 * counts an import of it as a barrel import.
 */
export { widgetInsights, type WidgetInsight } from './lib/widgetInsights';
export type { Insight, InsightCategory, TFunc } from './types';
export { isForSignedInAthlete, pushDataAthleteId, tapTargetFromPushData } from './lib/pushPayload';
export { INSIGHTS_CONFIG, confidenceFrom } from './lib/config';
export { HISTORY_MIN_POINTS } from './lib/sparkline';
export { printedValue } from './lib/printedValue';
export type { HistorySeries, InsightHistory } from './types';

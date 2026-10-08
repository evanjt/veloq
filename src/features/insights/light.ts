/**
 * What a module that must not load the Insights components needs: the types, and
 * the widget's pick from the ranked list. `scripts/lint-feature-imports.mjs`
 * counts an import of it as a barrel import.
 */
export { widgetInsights, type WidgetInsight } from './lib/widgetInsights';
export type { Insight, InsightCategory, TFunc } from './types';
export { isForSignedInAthlete, pushDataAthleteId, tapTargetFromPushData } from './lib/pushPayload';

export { InsightsPanel } from './components/InsightsPanel';
export { InsightListCard } from './components/InsightListCard';
export { InsightDetailSheet } from './components/InsightDetailSheet';
export { DataPointRow } from './components/DataPointRow';
export { SupportingDataSection } from './components/SupportingDataSection';
export { MethodologySection } from './components/MethodologySection';
export { InsightDebugPanel } from './components/InsightDebugPanel';
export { StrengthTab } from './components/StrengthTab';
export { InsightDetailContent } from './components/content/InsightDetailContent';
export { InsightSeriesChart } from './components/InsightSeriesChart';

export { useInsights } from './hooks/useInsights';
export type { ActivityInfo } from './lib/activityHighlight';
export type { SeriesSample } from './lib/seriesChart';
export type { DirectionBests } from './lib/directionBests';

export { generateInsights, getLastInsightOutcome } from './lib/generateInsights';
export {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
  consolidateInsights,
} from './lib/computeInsightsData';
export { INSIGHTS_CONFIG, confidenceFrom } from './lib/config';
export { HISTORY_MIN_POINTS } from './lib/sparkline';
export { printedValue } from './lib/printedValue';

export { stalePROpportunityToInsight } from './generators/stalePr';
export { generateEfficiencyTrendInsights } from './generators/efficiencyTrend';
export { generateSectionPRInsights } from './generators/sectionPR';
export { generateFitnessMilestoneInsights } from './generators/fitnessMilestone';

export {
  useInsightsStore,
  initialiseInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from './store';

export type {
  Insight,
  InsightCategory,
  InsightPriority,
  DataPoint,
  InsightAlternative,
  InsightMethodology,
  SupportingSection,
  InsightSupportingData,
  InsightMeta,
  PeriodStats,
  FtpTrend,
  PaceTrend,
  SectionPR,
  SectionTrendData,
  SeriesPoint,
  HistorySeries,
  InsightHistory,
  TFunc,
} from './types';

export { aboutInsightsBody, type InsightsTab } from './lib/aboutCopy';
export {
  openableSystemPath,
  isForSignedInAthlete,
  pushDataAthleteId,
  tapTargetFromPushData,
} from './lib/pushPayload';
export { buildInsightsParams } from './lib/insightsParams';
export { readTaskRuns, clearTaskRuns, type TaskRunEntry } from './lib/taskRunLog';
export { registerBackgroundNotificationTask } from './backgroundInsightTask';

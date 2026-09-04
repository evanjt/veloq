export { InsightsPanel } from './components/InsightsPanel';
export { InsightListCard } from './components/InsightListCard';
export { InsightDetailSheet } from './components/InsightDetailSheet';
export { DataPointRow } from './components/DataPointRow';
export { SupportingDataSection } from './components/SupportingDataSection';
export { MethodologySection } from './components/MethodologySection';
export { InsightDebugPanel } from './components/InsightDebugPanel';
export { StrengthTab } from './components/StrengthTab';
export { InsightDetailContent } from './components/content/InsightDetailContent';

export { useInsights } from './hooks/useInsights';

export { generateInsights, getLastInsightOutcome } from './lib/generateInsights';
export {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
  consolidateInsights,
} from './lib/computeInsightsData';
export type { WellnessInput } from './lib/computeInsightsData';
export { INSIGHTS_CONFIG } from './lib/config';

export { detectStalePROpportunities, stalePROpportunityToInsight } from './generators/stalePr';
export { generateEfficiencyTrendInsights } from './generators/efficiencyTrend';

export {
  useInsightsStore,
  initializeInsightsStore,
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
  SupportingActivity,
  InsightSupportingData,
  InsightMeta,
  PeriodStats,
  FtpTrend,
  PaceTrend,
  SectionPR,
  SectionTrendData,
  TFunc,
} from './types';

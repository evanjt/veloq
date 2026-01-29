// Activity hooks
export { useActivities, useActivityBoundsCache, useEFTPHistory } from './activities';

// Fitness & Wellness hooks
export { useWellness, useZoneDistribution, useAthleteSummary, getISOWeekNumber } from './fitness';

export {
  calculateTSB,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from '@/lib';

// Chart hooks
export { usePowerCurve, usePaceCurve, useChartColors } from './charts';

// UI hooks
export { useTheme, useMetricSystem } from './ui';

// Export types from ui
export type { Theme, ThemeColors } from './ui';

// Remaining hooks (not yet reorganized)
export { useAthlete } from './useAthlete';
export { useWellnessForDate, type TimeRange } from './fitness';
export { useInfiniteActivities, useActivity, useActivityStreams } from './activities';
export {
  useSportSettings,
  getSettingsForSport,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  getZoneColor,
} from './useSportSettings';
export {
  POWER_CURVE_DURATIONS,
  getPowerAtDuration,
  formatPowerCurveForChart,
  PACE_CURVE_DISTANCES,
  SWIM_PACE_CURVE_DISTANCES,
  getPaceAtDistance,
  paceToMinPerKm,
  paceToMinPer100m,
} from './charts';
export {
  useChartColor,
  useZoneColors,
  useFitnessColors,
  type ChartColorScheme,
  type ChartMetricType,
} from './charts';
export { getLatestFTP, getLatestEFTP } from './activities';
export { useOldestActivityDate } from './useOldestActivityDate';
export { useCacheDays } from './useCacheDays';

// Route hooks (already organized)
export { useRouteGroups } from './routes/useRouteGroups';
export { useRouteMatch } from './routes/useRouteMatch';
export { useRoutePerformances } from './routes/useRoutePerformances';
export { useRouteProcessing } from './routes/useRouteProcessing';
export { useFrequentSections } from './routes/useFrequentSections';
export { useSectionMatches } from './routes/useSectionMatches';
export {
  useSectionPerformances,
  type SectionLap,
  type ActivitySectionRecord,
} from './routes/useSectionPerformances';
export { useCustomSections, useCustomSection } from './routes/useCustomSections';
export { useUnifiedSections } from './routes/useUnifiedSections';
export { useEngineMapActivities } from './maps';

// Route Engine hooks (stateful Rust backend)
export {
  useRouteEngine,
  useEngineGroups,
  useEngineSections,
  useViewportActivities,
  useEngineStats,
  useConsensusRoute,
  // Query-on-demand hooks (lightweight, no memory bloat)
  useSectionSummaries,
  useSectionDetail,
  useGroupSummaries,
  useGroupDetail,
  useSectionPolyline,
} from './routes/useRouteEngine';
export { useRouteDataSync } from './routes/useRouteDataSync';
export { useRouteReoptimization } from './routes/useRouteReoptimization';
export { useRetentionCleanup } from './routes/useRetentionCleanup';

export { useSections } from './routes/useSections';
export { useSectionDetail } from './routes/useSectionDetail';

export { useSections } from './routes/useSections';
export { useSectionDetail } from './routes/useSectionDetail';

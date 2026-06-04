// Activity hooks
export {
  useActivities,
  useActivityBoundsCache,
  useEFTPHistory,
  useActivitySectionHighlights,
} from '@/features/activity/hooks';
export { useSectionOverlays } from '@/features/activity/hooks/useSectionOverlays';
export { useSectionTimeStreams } from '@/features/activity/hooks/useSectionTimeStreams';

// Fitness hooks
export {
  useZoneDistribution,
  useAthleteSummary,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  getISOWeekNumber,
  formatWeekRange,
  type WeeklySummaryData,
} from '@/features/fitness/hooks';

// Wellness hooks
export {
  useWellness,
  useWellnessForDate,
  timeRangeToDays,
  type TimeRange,
} from '@/features/wellness';

export {
  calculateTSB,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  FORM_ZONE_BOUNDARIES,
  type FormZone,
} from '@/features/fitness/lib/fitness';

// Chart hooks
export { usePowerCurve, usePaceCurve, useSeasonBests } from '@/features/stats';
export { useChartColors } from '@/shared/charts/useChartColors';
export type { BestEffort, UseSeasonBestsResult } from '@/features/stats';

// UI hooks
export { useTheme, useMetricSystem, useCollapsibleSections } from '@/shared/app';
export { useChartInteraction } from '@/shared/charts/useChartInteraction';

// Export types from shared/app
export type { Theme, ThemeColors, UseCollapsibleSections } from '@/shared/app';

// Remaining hooks (not yet reorganized)
export { useAthlete } from '@/shared/app/useAthlete';
export {
  useInfiniteActivities,
  useActivity,
  useActivityStreams,
  useActivityIntervals,
  isInfiniteActivitiesStale,
} from '@/features/activity/hooks';
export {
  useSportSettings,
  getSettingsForSport,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
  DEFAULT_POWER_ZONES,
  DEFAULT_HR_ZONES,
  getZoneColor,
} from '@/shared/app/useSportSettings';
export {
  POWER_CURVE_DURATIONS,
  getPowerAtDuration,
  getIndexAtDuration,
  formatPowerCurveForChart,
  PACE_CURVE_DISTANCES,
  SWIM_PACE_CURVE_DISTANCES,
  getPaceAtDistance,
  getIndexAtDistance,
  getTimeAtDistance,
  paceToMinPerKm,
  paceToMinPer100m,
} from '@/features/stats';
export {
  useChartColor,
  useZoneColors,
  useFitnessColors,
  type ChartColorScheme,
  type ChartMetricType,
} from '@/shared/charts/useChartColors';
export { getLatestFTP, getLatestEFTP } from '@/features/activity/hooks';
export { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
export { useCacheDays } from '@/shared/app/useCacheDays';

// Route hooks (already organized)
export { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
export { useRouteMatch } from '@/features/routes/hooks/useRouteMatch';
export { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
export { useRouteProcessing } from '@/features/routes/hooks/useRouteProcessing';
export { useFrequentSections } from '@/features/routes/hooks/useFrequentSections';
export { useSectionMatches } from '@/features/routes/hooks/useSectionMatches';
export {
  useSectionPerformances,
  type SectionLap,
  type SectionPerformanceRecord,
} from '@/features/routes/hooks/useSectionPerformances';
export { useCustomSections, useCustomSection } from '@/features/routes/hooks/useCustomSections';
export { useUnifiedSections } from '@/features/routes/hooks/useUnifiedSections';
export { useEngineMapActivities } from '@/features/maps/hooks';

// Route Engine hooks (stateful Rust backend)
export {
  useRouteEngine,
  useEngineSubscription,
  useEngineGroups,
  useEngineSections,
  useViewportActivities,
  useConsensusRoute,
  // Query-on-demand hooks (lightweight, no memory bloat)
  useSectionSummaries,
  useGroupSummaries,
  useGroupDetail,
  useSectionPolyline,
} from '@/features/routes/hooks/useRouteEngine';
export { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
export { useSectionChartData } from '@/features/routes/hooks/useSectionChartData';
export { useRouteReoptimization } from '@/features/routes/hooks/useRouteReoptimization';
export { useRoutesScreenData } from '@/features/routes/hooks/useRoutesScreenData';
// Section detail hook from route engine
export { useSectionDetail } from '@/features/routes/hooks/useRouteEngine';
// Section matching, nearby, merge, and re-scan hooks
export { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
export {
  useSectionActions,
  type UseSectionActionsResult,
} from '@/features/routes/hooks/useSectionActions';
export { useNearbySections } from '@/features/routes/hooks/useNearbySections';
export { useMergeSections } from '@/features/routes/hooks/useMergeSections';
export { useActivityRematch } from '@/features/routes/hooks/useActivityRematch';

// Home hooks
export { useSummaryCardData, type SummaryCardData } from '@/features/home/hooks';
export { useTodayWorkout } from '@/features/home/hooks';
export { useWorkoutSections, type WorkoutSection } from '@/features/home/hooks';
export { useActivityPatterns } from '@/features/home/hooks';

// Insights hooks
export { useInsights } from '@/features/insights';

// Location hooks
export { useUserLocation } from '@/shared/app/useUserLocation';

// Export hooks
export { useGpxExport } from './export';
export { useExportDatabaseBackup, useImportDatabaseBackup } from './export';
export { useBulkExport } from './export';

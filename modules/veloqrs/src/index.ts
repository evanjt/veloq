/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching and section detection.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloqrs from './NativeVeloqrs';

// Import generated functions for top-level aliases
import {
  BasemapManager,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiSection,
  type FfiSectionConfig,
  type FfiSectionPerformanceResult,
  type FfiSectionPerformanceRecord,
  type FfiRoutePerformanceResult,
  type FfiRoutePerformance,
  type FfiRankedSection,
  type FfiEfficiencyTrend,
  type FfiEfficiencyPoint,
  type FfiPeriodStats,
  type FfiDayLoad,
  type FfiPeriodComparison,
  type FfiMonthlyStats,
  type FfiZoneDistribution,
  type FfiSummaryCardData,
  type FfiFtpTrend,
  type FfiPaceTrend,
  type FfiInsightsData,
  type FfiInsightsParams,
  type FfiRecentPr,
  type FfiStartupData,
  type FfiMapScreenData,
  type FfiBestEffortsData,
  type FfiBestEffortsSport,
  type FfiBestEffort,
  type FfiClimbBests,
  type FfiClimbBest,
  type FfiTrainingScreenData,
  type FfiTrainingScreenWindows,
  type FfiFitnessScreenData,
  type FfiPreviewTrack,
  type FfiActivityDetailData,
  type FfiActivityFitnessImpact,
  type FfiActivityLedgerChange,
  type FfiHrZoneBand,
  type FfiSectionTrace,
  type FfiSectionDetailData,
  type FfiSectionPerformanceData,
  type FfiRoutesScreenData,
  type FfiRoutesScreenQuery,
  type FfiSectionFilters,
  FfiGroupSort,
  FfiSectionSort,
  FfiFeedGroup,
  type FfiActivityBodiesQuery,
  type FfiActivityBodiesPage,
  type FfiGroupWithPolyline,
  type FfiSectionWithPolyline,
  type FfiStalePrOpportunity,
  type FfiSectionChange,
  type FfiHrvTrend,
  type FfiBackupValidation,
  type FfiEftpChange,
} from './generated/veloqrs';

import { EngineClient } from './EngineClient';

// Install the Rust crate into the JS runtime (installs NativeVeloqrs on globalThis)
const installed = NativeVeloqrs.installRustCrate();
if (!installed && __DEV__) {
  console.warn('[RouteMatcher] Failed to install Rust crate. Native functions may not work.');
}

// Re-export all generated types and functions
export * from './generated/veloqrs';

// Re-export conversions, types, and utilities
export { validateId, validateName } from './conversions';
export { decodeCoords, decodeCoordsFlat, type LatLng, type LatLngShort } from './coords';
export type { SectionDetectionProgress, CustomSection, FetchProgressEvent } from './conversions';

// Re-export EngineClient and its locally-defined types
export { EngineClient, type HeatmapDay, type SectionEncounter } from './EngineClient';

// Sync service (SyncManager) consumer types
export type { SyncStatus, SyncAuthMethod } from './delegates/sync';
export type {
  FfiCallOutcome as CallOutcome,
  FfiUploadResult as UploadResult,
} from './generated/veloqrs';
export {
  FfiCallKind as CallKind,
  FfiUploadOutcome as UploadOutcome,
  FfiSyncErrorReason as SyncErrorReason,
  FfiSyncStep as SyncStep,
} from './generated/veloqrs';

// The verdict every start answers with, and the one place that says which
// refusals lift on their own. See `delegates/start.ts`.
export { FfiStartOutcome as StartOutcome } from './generated/veloqrs';
export type { FfiStartResult as StartResult } from './generated/veloqrs';
export type StartVerdict =
  | import('./generated/veloqrs').FfiStartOutcome
  | import('./generated/veloqrs').FfiStartResult;
export { isRetryableStart, hasStarted, startOutcome } from './delegates/start';

// Why the engine did not open, for the banner to translate. See
// `delegates/init.ts`.
export { FfiInitOutcome as InitOutcome } from './generated/veloqrs';
export type { FfiQuarantineReport as QuarantineReport } from './generated/veloqrs';
export { isRetryableInit, hasOpened } from './delegates/init';

// Elevation backfill consumer types
export type { ElevationBackfillPhase } from './delegates/elevation';
export type { RoutesStatus } from './delegates/routesStatus';
export type { StreamBackfillPhase } from './delegates/streamBackfill';

// Detector cutover consumer types
export type {
  CutoverPhase,
  CutoverCounts,
  CutoverSettings,
  CutoverSettingsReset,
} from './delegates/cutover';

// Preview detection consumer types
export type {
  PreviewCentre,
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
  PreviewSection,
  PreviewSectionStatus,
} from './delegates/preview';

export type {
  RouteGroupPreview,
  RouteGroupingPreviewClient,
} from './delegates/routeGroupingPreview';

// The typed wellness day the fitness and wellness screens read
export type {
  WellnessDay,
  WellnessSparklines,
  SportLoad,
  CurveActivityRow,
  PowerModelRow,
  PowerCurveRow,
  PaceCurveRow,
} from './delegates/fitness';

// Delegate-shaped bundles returned by the façade
export type { ActivityHighlightsBundle } from './delegates/activities';
export type { RouteDetailData } from './delegates/routes';

// Re-export types with shorter names for convenience
export type ActivityMetrics = FfiActivityMetrics;
export type GpsPoint = FfiGpsPoint;
export type RouteGroup = FfiRouteGroup;
export type Section = FfiSection;
export type SectionConfig = FfiSectionConfig;
export type SectionPerformanceResult = FfiSectionPerformanceResult;
export type SectionPerformanceRecord = FfiSectionPerformanceRecord;
export type RoutePerformanceResult = FfiRoutePerformanceResult;
export type RoutePerformance = FfiRoutePerformance;
export type RankedSection = FfiRankedSection;
export type EfficiencyTrend = FfiEfficiencyTrend;
export type EfficiencyPoint = FfiEfficiencyPoint;
// Aggregate query types
export type PeriodStats = FfiPeriodStats;
/** One period against an earlier one, with the metric it was taken on. */
export type PeriodComparison = FfiPeriodComparison;
export { FfiLoadMetric as LoadMetric } from './generated/veloqrs';
export type MonthlyStats = FfiMonthlyStats;
/** A sport's seconds per zone with the athlete's own zone names. */
export type ZoneDistributionData = FfiZoneDistribution;
/** One local day's recorded activity load and whether it is complete. */
export type DayLoad = FfiDayLoad;
export { FfiDayLoadStatus as DayLoadStatus } from './generated/veloqrs';
export type SummaryCardData = FfiSummaryCardData;
export type FtpTrend = FfiFtpTrend;
export type PaceTrend = FfiPaceTrend;
// Insights batch types
export type InsightsData = FfiInsightsData;
export type InsightsParams = FfiInsightsParams;
export type RecentPR = FfiRecentPr;
// Startup batch types
export type StartupData = FfiStartupData;
export type MapScreenData = FfiMapScreenData;
// Best Efforts screen types
export type BestEffortsData = FfiBestEffortsData;
export type BestEffortsSport = FfiBestEffortsSport;
export type BestEffort = FfiBestEffort;
export type ClimbBests = FfiClimbBests;
export type ClimbBest = FfiClimbBest;
// Training screen types
export type TrainingScreenData = FfiTrainingScreenData;
export type TrainingScreenWindows = FfiTrainingScreenWindows;
// Fitness screen types
export type FitnessScreenData = FfiFitnessScreenData;
export type PreviewTrack = FfiPreviewTrack;
// Activity detail batch types
export type ActivityDetailData = FfiActivityDetailData;
export type ActivityFitnessImpact = FfiActivityFitnessImpact;
export type ActivityLedgerChange = FfiActivityLedgerChange;
export type HrZoneBand = FfiHrZoneBand;
export type SectionTrace = FfiSectionTrace;
// Section detail batch types
export type SectionDetailData = FfiSectionDetailData;
export type SectionPerformanceData = FfiSectionPerformanceData;
// Routes screen batch types
export type RoutesScreenData = FfiRoutesScreenData;
export type RoutesScreenQuery = FfiRoutesScreenQuery;
export type SectionHiddenFilters = FfiSectionFilters;
export { FfiGroupSort as GroupSort, FfiSectionSort as SectionSort };
// Feed search over the whole library
export type ActivityBodiesQuery = FfiActivityBodiesQuery;
export type ActivityBodiesPage = FfiActivityBodiesPage;
export { FfiFeedGroup as FeedSportGroup };
export type GroupWithPolyline = FfiGroupWithPolyline;
export type SectionWithPolyline = FfiSectionWithPolyline;
export type StalePrOpportunity = FfiStalePrOpportunity;
/** One visible change the section ledger recorded. */
export type SectionChange = FfiSectionChange;
/** The HRV verdict over a trailing window. */
export type HrvTrend = FfiHrvTrend;
/** What the native probe reports about a picked backup file. */
export type BackupValidation = FfiBackupValidation;
/** One activity that moved the athlete's accepted eFTP. */
export type EftpChange = FfiEftpChange;
export type {
  FfiSectionMatch as SectionMatch,
  FfiMergeCandidate as MergeCandidate,
  FfiActivityRouteHighlight as ActivityRouteHighlight,
} from './EngineClient';
/** A ride a merge would take out of the merged section. */
export type { FfiMergeDropped as MergeDropped } from './generated/veloqrs';
// Strength training types
export type {
  FfiExerciseSet as ExerciseSet,
  FfiExerciseGroup as ExerciseGroup,
  FfiExerciseSession as ExerciseSession,
  FfiExerciseDetailData as ExerciseDetailData,
  FfiMuscleGroup as MuscleGroup,
  FfiActivityNotification as ActivityNotification,
} from './generated/veloqrs';

export const engine = EngineClient.getInstance();

/**
 * The Rust-owned basemap tile store.
 *
 * Not on `EngineClient`: a tile read must not queue behind the engine lock,
 * and the store answers from the filesystem without needing the library open.
 */
let _basemap: BasemapManager | null = null;

export function basemapStore(): BasemapManager {
  if (!_basemap) {
    _basemap = new BasemapManager();
  }
  return _basemap;
}

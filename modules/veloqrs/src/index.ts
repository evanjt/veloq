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
  getDownloadProgress as ffiGetDownloadProgress,
  type DownloadProgressResult,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiFrequentSection,
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
  type FfiSummaryCardData,
  type FfiFtpTrend,
  type FfiPaceTrend,
  type FfiInsightsData,
  type FfiInsightsParams,
  type FfiRecentPr,
  type FfiStartupData,
  type FfiWidgetSnapshotData,
  type FfiMapScreenData,
  type FfiPreviewTrack,
  type FfiActivityDetailData,
  type FfiSectionTrace,
  type FfiSectionDetailData,
  type FfiSectionPerformanceData,
  type FfiRoutesScreenData,
  type FfiGroupWithPolyline,
  type FfiSectionWithPolyline,
  type FfiPotentialSection,
  type FfiStalePrOpportunity,
} from './generated/veloqrs';

import { RouteEngineClient } from './RouteEngineClient';

// Install the Rust crate into the JS runtime (installs NativeVeloqrs on globalThis)
const installed = NativeVeloqrs.installRustCrate();
if (!installed && __DEV__) {
  console.warn('[RouteMatcher] Failed to install Rust crate. Native functions may not work.');
}

// Re-export all generated types and functions
export * from './generated/veloqrs';

// Re-export conversions, types, and utilities
export {
  flatCoordsToPoints,
  gpsPointsToRoutePoints,
  routePointsToGpsPoints,
  validateId,
  validateName,
} from './conversions';
export { decodeCoords, type LatLng } from './coords';
export type {
  RoutePoint,
  SectionDetectionProgress,
  CustomSection,
  FetchProgressEvent,
} from './conversions';

// Re-export RouteEngineClient and its locally-defined types
export { RouteEngineClient, type HeatmapDay, type SectionEncounter } from './RouteEngineClient';

// Sync service (SyncManager) consumer types
export type { SyncStatus, SyncAuthMethod } from './delegates/sync';
export type {
  FfiCallOutcome as CallOutcome,
  FfiManualActivity as ManualActivity,
} from './generated/veloqrs';

// Elevation backfill consumer types
export type { ElevationBackfillPhase } from './delegates/elevation';

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

// Delegate-shaped bundles returned by the façade
export type { ActivityHighlightsBundle } from './delegates/activities';
export type { RouteDetailData } from './delegates/routes';

// Re-export types with shorter names for convenience
export type ActivityMetrics = FfiActivityMetrics;
export type GpsPoint = FfiGpsPoint;
export type RouteGroup = FfiRouteGroup;
export type FrequentSection = FfiFrequentSection;
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
export type SummaryCardData = FfiSummaryCardData;
export type FtpTrend = FfiFtpTrend;
export type PaceTrend = FfiPaceTrend;
// Insights batch types
export type InsightsData = FfiInsightsData;
export type InsightsParams = FfiInsightsParams;
export type RecentPR = FfiRecentPr;
// Startup batch types
export type StartupData = FfiStartupData;
export type WidgetSnapshotData = FfiWidgetSnapshotData;
export type MapScreenData = FfiMapScreenData;
export type PreviewTrack = FfiPreviewTrack;
// Activity detail batch types
export type ActivityDetailData = FfiActivityDetailData;
export type SectionTrace = FfiSectionTrace;
// Section detail batch types
export type SectionDetailData = FfiSectionDetailData;
export type SectionPerformanceData = FfiSectionPerformanceData;
// Routes screen batch types
export type RoutesScreenData = FfiRoutesScreenData;
export type GroupWithPolyline = FfiGroupWithPolyline;
export type SectionWithPolyline = FfiSectionWithPolyline;
export type PotentialSection = FfiPotentialSection;
export type StalePrOpportunity = FfiStalePrOpportunity;
export type {
  FfiSectionMatch as SectionMatch,
  FfiMergeCandidate as MergeCandidate,
  FfiNearbySectionSummary as NearbySectionSummary,
  FfiActivitySectionHighlight as ActivitySectionHighlight,
  FfiActivityRouteHighlight as ActivityRouteHighlight,
} from './RouteEngineClient';
// Strength training types
export type {
  FfiExerciseSet as ExerciseSet,
  FfiMuscleGroup as MuscleGroup,
} from './generated/veloqrs';

export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
}

export const routeEngine = RouteEngineClient.getInstance();

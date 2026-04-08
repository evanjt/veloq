/**
 * Route Matcher Native Module
 *
 * Auto-generated Turbo Module bindings via uniffi-bindgen-react-native.
 * Provides high-performance route matching and section detection.
 */

// Import the Turbo Module to install JSI bindings
import NativeVeloqrs from "./NativeVeloqrs";

// Install the Rust crate into the JS runtime (installs NativeVeloqrs on globalThis)
const installed = NativeVeloqrs.installRustCrate();
if (!installed && __DEV__) {
  console.warn(
    "[RouteMatcher] Failed to install Rust crate. Native functions may not work.",
  );
}

// Re-export all generated types and functions
export * from "./generated/veloqrs";

// Re-export conversions, types, and utilities
export {
  flatCoordsToPoints,
  gpsPointsToRoutePoints,
  routePointsToGpsPoints,
  validateId,
  validateName,
} from "./conversions";
export type {
  RoutePoint,
  SectionDetectionProgress,
  CustomSection,
  FetchProgressEvent,
} from "./conversions";

// Re-export RouteEngineClient and its locally-defined types
export { RouteEngineClient, type HeatmapDay } from "./RouteEngineClient";

// Import generated functions for top-level aliases
import {
  getDownloadProgress as ffiGetDownloadProgress,
  type DownloadProgressResult,
  type FfiActivityMetrics,
  type FfiBounds,
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
  type PersistentEngineStats,
  type SectionSummary,
  type GroupSummary,
  type MapActivityComplete,
  type FfiPeriodStats,
  type FfiFtpTrend,
  type FfiPaceTrend,
  type FfiInsightsData,
  type FfiRecentPr,
  type FfiStartupData,
  type FfiPreviewTrack,
  type FfiRoutesScreenData,
  type FfiGroupWithPolyline,
  type FfiSectionWithPolyline,
  type FfiPotentialSection,
} from "./generated/veloqrs";

import { RouteEngineClient } from "./RouteEngineClient";

// Re-export types with shorter names for convenience
export type { FfiBounds };
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
// These are already exported without Ffi prefix:
export type {
  PersistentEngineStats,
  SectionSummary,
  GroupSummary,
  DownloadProgressResult,
  MapActivityComplete,
};
// Aggregate query types
export type PeriodStats = FfiPeriodStats;
export type FtpTrend = FfiFtpTrend;
export type PaceTrend = FfiPaceTrend;
// Insights batch types
export type InsightsData = FfiInsightsData;
export type RecentPR = FfiRecentPr;
// Startup batch types
export type StartupData = FfiStartupData;
export type PreviewTrack = FfiPreviewTrack;
// Routes screen batch types
export type RoutesScreenData = FfiRoutesScreenData;
export type GroupWithPolyline = FfiGroupWithPolyline;
export type SectionWithPolyline = FfiSectionWithPolyline;
export type PotentialSection = FfiPotentialSection;
export type {
  FfiSectionMatch as SectionMatch,
  FfiMergeCandidate as MergeCandidate,
  FfiNearbySectionSummary as NearbySectionSummary,
} from './RouteEngineClient';
// Strength training types (generated after Rust rebuild)
export interface ExerciseSet {
  activityId: string;
  setOrder: number;
  exerciseCategory: number;
  exerciseName: number | undefined;
  displayName: string;
  setType: number;
  repetitions: number | undefined;
  weightKg: number | undefined;
  durationSecs: number | undefined;
}
export interface MuscleGroup {
  slug: string;
  intensity: number;
}

export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
}

export const routeEngine = RouteEngineClient.getInstance();

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
  RawPotentialSection,
  FetchProgressEvent,
} from "./conversions";

// Re-export RouteEngineClient
export { RouteEngineClient } from "./RouteEngineClient";

// Import generated functions for top-level aliases
import {
  ffiDetectSectionsMultiscale,
  defaultScalePresets,
  getDownloadProgress as ffiGetDownloadProgress,
  type DownloadProgressResult,
  type FfiActivityMetrics,
  type FfiGpsPoint,
  type FfiRouteGroup,
  type FfiFrequentSection,
  type FfiSection,
  FfiSectionConfig,
  type FfiSectionPerformanceResult,
  type FfiSectionPerformanceRecord,
  type FfiRoutePerformanceResult,
  type FfiRoutePerformance,
  type PersistentEngineStats,
  type SectionSummary,
  type GroupSummary,
  type MapActivityComplete,
  type FfiPeriodStats,
  type FfiMonthlyAggregate,
  type FfiHeatmapDay,
  type FfiFtpTrend,
  type FfiPaceTrend,
  type FfiRoutesScreenData,
  type FfiGroupWithPolyline,
  type FfiSectionWithPolyline,
} from "./generated/veloqrs";

import { RouteEngineClient } from "./RouteEngineClient";

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
export type MonthlyAggregate = FfiMonthlyAggregate;
export type HeatmapDay = FfiHeatmapDay;
export type FtpTrend = FfiFtpTrend;
export type PaceTrend = FfiPaceTrend;
// Routes screen batch types
export type RoutesScreenData = FfiRoutesScreenData;
export type GroupWithPolyline = FfiGroupWithPolyline;
export type SectionWithPolyline = FfiSectionWithPolyline;

// For backward compatibility, also export the module initialization status
export function isRouteMatcherInitialized(): boolean {
  return installed;
}

export const detectSectionsMultiscale = ffiDetectSectionsMultiscale;
export const getDefaultScalePresets = defaultScalePresets;

export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
}

export const routeEngine = RouteEngineClient.getInstance();

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
  fetchActivityMaps,
  fetchActivityMapsWithProgress as generatedFetchWithProgress,
  getDownloadProgress as ffiGetDownloadProgress,
  type FetchProgressCallback,
  type FfiActivityMapResult,
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
  type FfiRoutesScreenData,
  type FfiGroupWithPolyline,
  type FfiSectionWithPolyline,
} from "./generated/veloqrs";

import type { FetchProgressEvent } from "./conversions";
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
// Routes screen batch types
export type RoutesScreenData = FfiRoutesScreenData;
export type GroupWithPolyline = FfiGroupWithPolyline;
export type SectionWithPolyline = FfiSectionWithPolyline;

// For backward compatibility, also export the module initialization status
export function isRouteMatcherInitialized(): boolean {
  return installed;
}

/**
 * Alias for backward compatibility.
 */
export const detectSectionsMultiscale = ffiDetectSectionsMultiscale;
export const getDefaultScalePresets = defaultScalePresets;

/**
 * Fetch activity maps with optional progress reporting.
 *
 * @param authHeader - Pre-formatted Authorization header value:
 *   - For API key auth: "Basic {base64(API_KEY:key)}"
 *   - For OAuth: "Bearer {access_token}"
 * @param onProgress - Optional callback for progress updates. If not provided,
 *   uses the non-callback version which is safer for React Native.
 */
export async function fetchActivityMapsWithProgress(
  authHeader: string,
  activityIds: string[],
  onProgress?: (event: FetchProgressEvent) => void,
): Promise<FfiActivityMapResult[]> {
  if (!onProgress) {
    // Use non-callback version - avoids cross-thread FFI callback issues
    return fetchActivityMaps(authHeader, activityIds);
  }

  // Create callback adapter that conforms to FetchProgressCallback interface
  const callback: FetchProgressCallback = {
    onProgress: (completed: number, total: number) => {
      onProgress({ completed, total });
    },
  };

  return generatedFetchWithProgress(authHeader, activityIds, callback);
}

/**
 * Get current download progress for polling.
 *
 * Call this every 100ms during fetch operations to get smooth progress updates.
 * Avoids cross-thread FFI callback issues by using atomic counters in Rust.
 *
 * @returns Progress with completed/total/active fields
 */
export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
}

// Export the singleton instance for backward compatibility
export const routeEngine = RouteEngineClient.getInstance();

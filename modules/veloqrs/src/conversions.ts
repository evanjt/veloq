/**
 * Point conversions, validators, and shared types for the veloqrs module.
 */

import type { FfiGpsPoint } from "./generated/veloqrs";

/**
 * Simple point type with lat/lng (used by app code).
 */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/**
 * Progress state for section detection.
 */
export interface SectionDetectionProgress {
  /** Current phase: "loading", "building_rtrees", "finding_overlaps", "clustering", "building_sections", "postprocessing", "complete" */
  phase: string;
  /** Number of items completed in current phase */
  completed: number;
  /** Total items in current phase */
  total: number;
}

/**
 * A user-created custom section.
 * Created by selecting a portion of an activity's GPS track.
 */
export interface CustomSection {
  /** Unique section ID */
  id: string;
  /** User-defined or auto-generated name */
  name: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Start index in the source activity's GPS track */
  startIndex: number;
  /** End index in the source activity's GPS track */
  endIndex: number;
  /** Activity ID this section was created from */
  sourceActivityId: string;
  /** Sport type (e.g., "Ride", "Run") */
  sportType: string;
  /** Section length in meters */
  distanceMeters: number;
  /** ISO timestamp when the section was created */
  createdAt: string;
}

/**
 * Raw potential section from Rust (uses GpsPoint polyline, not RoutePoint).
 * Internal type - not exported. Caller should convert polyline using gpsPointsToRoutePoints().
 */
export interface RawPotentialSection {
  id: string;
  sport_type: string;
  polyline: FfiGpsPoint[];
  activity_ids: string[];
  visit_count: number;
  distance_meters: number;
  confidence: number;
  scale: string;
}

/**
 * Progress event from fetch operations.
 */
export interface FetchProgressEvent {
  completed: number;
  total: number;
}

/**
 * Maximum allowed length for user-provided names (route names, section names).
 */
const MAX_NAME_LENGTH = 255;

/**
 * Regular expression to detect control characters (except common whitespace).
 * Allows: space, tab, newline, carriage return
 * Blocks: null, bell, backspace, form feed, vertical tab, escape, etc.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Validate a user-provided name string.
 * Throws an error if the name is invalid.
 */
export function validateName(name: string, fieldName: string): void {
  if (typeof name !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_REGEX.test(name)) {
    throw new Error(
      `Invalid ${fieldName}: contains disallowed control characters`,
    );
  }
}

/**
 * Validate a user-provided ID string.
 * Throws an error if the ID is invalid.
 */
export function validateId(id: string, fieldName: string): void {
  if (typeof id !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (id.length === 0) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }
  if (id.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_REGEX.test(id)) {
    throw new Error(
      `Invalid ${fieldName}: contains disallowed control characters`,
    );
  }
}

/**
 * Convert flat coordinate array to GpsPoint array.
 * @param flatCoords - Flat array [lat1, lng1, lat2, lng2, ...]
 * @returns Array of GpsPoint objects
 */
export function flatCoordsToPoints(flatCoords: number[]): FfiGpsPoint[] {
  const points: FfiGpsPoint[] = [];
  for (let i = 0; i < flatCoords.length - 1; i += 2) {
    points.push({
      latitude: flatCoords[i],
      longitude: flatCoords[i + 1],
      elevation: undefined,
    });
  }
  return points;
}

/**
 * Convert GpsPoint array to RoutePoint array (lat/lng format).
 */
export function gpsPointsToRoutePoints(points: FfiGpsPoint[]): RoutePoint[] {
  return points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

/**
 * Convert RoutePoint array to GpsPoint array (latitude/longitude format).
 */
export function routePointsToGpsPoints(points: RoutePoint[]): FfiGpsPoint[] {
  return points.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
    elevation: undefined,
  }));
}

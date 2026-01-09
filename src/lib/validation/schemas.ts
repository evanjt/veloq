/**
 * Zod schemas for runtime validation with automatic type inference.
 *
 * Provides type-safe validation with detailed error messages for critical data structures.
 * Schemas can be used to both validate data AND infer TypeScript types.
 *
 * @example
 * ```ts
 * import { MapPreferencesSchema } from '@/lib/validation/schemas';
 * type MapPreferences = z.infer<typeof MapPreferencesSchema>;
 *
 * const result = MapPreferencesSchema.safeParse(data);
 * if (result.success) {
 *   // result.data is typed as MapPreferences
 * }
 * ```
 */

import { z } from 'zod';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType } from '@/types';

// =============================================================================
// Map Preferences Schema
// =============================================================================

/** Valid map style values */
const MapStyleSchema: z.ZodType<MapStyleType> = z.enum(['light', 'dark', 'satellite']);

/** Activity type validation (all 19 Strava sport types) */
const ActivityTypeSchema: z.ZodType<ActivityType> = z.enum([
  'Ride',
  'Run',
  'Swim',
  'Walk',
  'Hike',
  'VirtualRide',
  'VirtualRun',
  'Workout',
  'Yoga',
  'AlpineSki',
  'BackcountrySki',
  'Canoeing',
  'Crossfit',
  'EBikeRide',
  'Elliptical',
  'IceSkate',
  'InlineSkate',
  'Kayaking',
  'Kitesurf',
  'NordicSki',
  'RockClimbing',
  'RollerSki',
  'Rowing',
  'Snowboard',
  'Snowshoe',
  'StairStepper',
  'StandUpPaddling',
  'Surfing',
  'WeightTraining',
  'Windsurf',
  'Wheelchair',
]);

/**
 * Map preferences schema.
 * Validates user's map display settings including default style and per-activity-type overrides.
 */
export const MapPreferencesSchema = z.object({
  defaultStyle: MapStyleSchema,
  activityTypeStyles: z.record(ActivityTypeSchema, MapStyleSchema).optional().default({}),
});

/** Type inferred from MapPreferencesSchema */
export type MapPreferences = z.infer<typeof MapPreferencesSchema>;

// =============================================================================
// GPS Storage Schemas
// =============================================================================

/** GPS coordinate pair [latitude, longitude] */
const GpsCoordinateSchema = z.tuple([
  z.number().min(-90).max(90),   // latitude
  z.number().min(-180).max(180), // longitude
]);

/** GPS track - array of coordinate pairs */
export const GpsTrackSchema = z.array(GpsCoordinateSchema).min(2);

/** Type inferred from GpsTrackSchema */
export type GpsTrack = z.infer<typeof GpsTrackSchema>;

/**
 * GPS index schema.
 * Tracks all stored GPS tracks for bulk operations.
 */
export const GpsIndexSchema = z.object({
  activityIds: z.array(z.string()),
  lastUpdated: z.string().datetime(), // ISO 8601 datetime
});

/** Type inferred from GpsIndexSchema */
export type GpsIndex = z.infer<typeof GpsIndexSchema>;

// =============================================================================
// Rust Engine Data Schemas
// =============================================================================

/**
 * Activity metrics schema for Rust engine.
 * Validates data sent to native route-matcher module.
 */
export const ActivityMetricsSchema = z.object({
  activityId: z.string(),
  name: z.string(),
  date: z.number().int().positive(), // Unix timestamp
  distance: z.number().nonnegative(), // meters
  movingTime: z.number().int().nonnegative(), // seconds
  elapsedTime: z.number().int().nonnegative(), // seconds
  elevationGain: z.number().nonnegative(), // meters
  avgHr: z.number().positive().optional(), // BPM
  avgPower: z.number().nonnegative().optional(), // watts
  sportType: ActivityTypeSchema,
});

/** Type inferred from ActivityMetricsSchema */
export type ActivityMetrics = z.infer<typeof ActivityMetricsSchema>;

// =============================================================================
// Sync State Schemas
// =============================================================================

/** Sync status values */
const SyncStatusSchema = z.enum(['idle', 'syncing', 'complete', 'error']);

/**
 * Route sync progress schema.
 * Tracks progress of GPS data synchronization.
 */
export const SyncProgressSchema = z.object({
  status: SyncStatusSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string().optional(),
});

/** Type inferred from SyncProgressSchema */
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Safely parse and validate data using a Zod schema.
 * Returns null if validation fails (with console warning).
 *
 * @param data - Unknown data to validate
 * @param schema - Zod schema to validate against
 * @param context - Description for error logging
 * @returns Validated data or null
 *
 * @example
 * ```ts
 * const prefs = safeParseWithSchema(data, MapPreferencesSchema, 'MapPreferences');
 * if (prefs) {
 *   // prefs is guaranteed to match MapPreferences type
 * }
 * ```
 */
export function safeParseWithSchema<T>(
  data: unknown,
  schema: z.ZodSchema<T>,
  context: string
): T | null {
  const result = schema.safeParse(data);

  if (!result.success) {
    console.warn(`[Zod] ${context} validation failed:`, result.error.format());
    return null;
  }

  return result.data;
}

/**
 * Parse with schema and throw detailed error on failure.
 * Use when validation failure is a critical error.
 *
 * @param data - Unknown data to validate
 * @param schema - Zod schema to validate against
 * @param context - Description for error message
 * @returns Validated data
 * @throws Error with detailed validation issues
 *
 * @example
 * ```ts
 * try {
 *   const metrics = parseWithSchemaStrict(data, ActivityMetricsSchema, 'ActivityMetrics');
 * } catch (error) {
 *   // Handle validation error
 * }
 * ```
 */
export function parseWithSchemaStrict<T>(
  data: unknown,
  schema: z.ZodSchema<T>,
  context: string
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const formatted = JSON.stringify(result.error.format(), null, 2);
    throw new Error(`${context} validation failed:\n${formatted}`);
  }

  return result.data;
}

/**
 * Create a schema validator compatible with safeJsonParseWithSchema.
 * Bridges Zod schemas with existing validation utilities.
 *
 * @param schema - Zod schema to convert to type guard
 * @returns Type guard function
 *
 * @example
 * ```ts
 * const validator = createSchemaValidator(MapPreferencesSchema);
 * const prefs = safeJsonParseWithSchema(json, validator, defaultPrefs);
 * ```
 */
export function createSchemaValidator<T>(
  schema: z.ZodSchema<T>
): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    return schema.safeParse(value).success;
  };
}

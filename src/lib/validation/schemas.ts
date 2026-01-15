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
const MapStyleSchema = z.enum(['light', 'dark', 'satellite']);

/** Activity type validation (standard fitness sport types) */
const ActivityTypeSchema = z.enum([
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
  activityTypeStyles: z.record(ActivityTypeSchema, MapStyleSchema).optional(),
});

/** Type inferred from MapPreferencesSchema */
export type MapPreferences = z.infer<typeof MapPreferencesSchema>;

// =============================================================================
// GPS Storage Schemas
// =============================================================================

/** GPS coordinate pair [latitude, longitude] */
const GpsCoordinateSchema = z.tuple([
  z.number().min(-90).max(90), // latitude
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
// Custom Section Schema (for native module validation)
// =============================================================================

/** Maximum payload size for custom sections (100KB) */
export const CUSTOM_SECTION_MAX_SIZE_BYTES = 100 * 1024;

/** GPS point schema for custom section polylines */
const GpsPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().optional(),
});

/**
 * Custom section schema.
 * Validates user-created sections before passing to Rust engine.
 * Enforces field length limits and coordinate bounds to prevent malformed data.
 */
export const CustomSectionSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  polyline: z.array(GpsPointSchema).min(2),
  sourceActivityId: z.string().min(1).max(255),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  sportType: z.string().min(1).max(50),
  distanceMeters: z.number().nonnegative(),
  createdAt: z.string().optional(),
});

/** Type inferred from CustomSectionSchema */
export type ValidatedCustomSection = z.infer<typeof CustomSectionSchema>;

/**
 * Validates a custom section payload including size check.
 * Throws descriptive errors for validation failures.
 *
 * @param input - Custom section data (object or JSON string)
 * @returns Validated custom section object
 * @throws Error if validation fails or payload exceeds size limit
 */
export function validateCustomSection(input: unknown): ValidatedCustomSection {
  // Handle JSON string input
  let data: unknown = input;
  let jsonString: string;

  if (typeof input === 'string') {
    jsonString = input;
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('CustomSection validation failed: Invalid JSON string');
    }
  } else {
    jsonString = JSON.stringify(input);
  }

  // Check payload size (100KB limit)
  const sizeBytes = new TextEncoder().encode(jsonString).length;
  if (sizeBytes > CUSTOM_SECTION_MAX_SIZE_BYTES) {
    throw new Error(
      `CustomSection validation failed: Payload size (${sizeBytes} bytes) exceeds maximum allowed size (${CUSTOM_SECTION_MAX_SIZE_BYTES} bytes)`
    );
  }

  // Validate against schema
  const result = CustomSectionSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`CustomSection validation failed: ${issues}`);
  }

  return result.data;
}

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
    if (__DEV__) {
      console.warn(`[Zod] ${context} validation failed:`, result.error.format());
    }
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
export function createSchemaValidator<T>(schema: z.ZodSchema<T>): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    return schema.safeParse(value).success;
  };
}

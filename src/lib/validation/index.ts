/**
 * Validation utilities - runtime type checking and schema validation.
 *
 * Provides both type guards (TypeScript-level) and Zod schemas (runtime validation).
 *
 * @example
 * ```ts
 * // Using type guards (TypeScript-only, no error messages)
 * import { isValidMapPreferences } from '@/lib/validation';
 * if (isValidMapPreferences(data)) { ... }
 *
 * // Using Zod schemas (detailed error messages)
 * import { MapPreferencesSchema } from '@/lib/validation/schemas';
 * const result = MapPreferencesSchema.safeParse(data);
 * ```
 */

export * from './schemas';
export * from '../utils/validation';

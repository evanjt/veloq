/**
 * Safe JSON parsing utilities with graceful error handling and schema validation.
 */

/**
 * Safely parse JSON with a fallback value.
 * Returns the fallback if parsing fails or returns null/undefined.
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Validator function type for schema validation.
 */
export type SchemaValidator<T> = (value: unknown) => value is T;

/**
 * Safely parse JSON with schema validation.
 * Returns the fallback if parsing fails or the parsed value doesn't match the schema.
 *
 * @param json - JSON string to parse
 * @param validator - Function that validates the parsed value matches expected schema
 * @param fallback - Default value if parsing/validation fails
 */
export function safeJsonParseWithSchema<T>(
  json: string | null | undefined,
  validator: SchemaValidator<T>,
  fallback: T
): T {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    if (validator(parsed)) {
      return parsed;
    }
    console.warn('[validation] Schema validation failed, using fallback');
    return fallback;
  } catch (e) {
    console.warn('[validation] JSON parse failed:', e);
    return fallback;
  }
}

/**
 * Helper to validate an object has expected string keys with specific allowed values.
 */
export function isValidRecord<K extends string, V>(
  value: unknown,
  validKeys: Set<K>,
  validValues: Set<V>
): value is Record<K, V> {
  if (typeof value !== 'object' || value === null) return false;
  for (const [key, val] of Object.entries(value)) {
    if (!validKeys.has(key as K) || !validValues.has(val as V)) {
      return false;
    }
  }
  return true;
}

/**
 * Safe JSON parsing utilities with graceful error handling.
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

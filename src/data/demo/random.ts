/**
 * Deterministic random number generation for demo data.
 *
 * Uses mulberry32 PRNG seeded from date strings to produce
 * reproducible sequences of "random" values.
 */

/**
 * Reference date for demo data generation.
 * Uses today's date so demo mode always has current data.
 * Seeding is deterministic based on day offset, not absolute date.
 */
function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const DEMO_REFERENCE_DATE = getTodayDateString();

/**
 * Mulberry32 PRNG - fast, simple, 32-bit state
 * Returns a function that produces values in [0, 1)
 */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a hash from a string (for seeding PRNG)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a seeded random generator from a string
 */
export function createSeededRandom(seed: string): () => number {
  return mulberry32(hashString(seed));
}

/**
 * Create a seeded random generator from a date string
 */
export function createDateSeededRandom(dateStr: string): () => number {
  return createSeededRandom(dateStr);
}

/**
 * Create a seeded random generator from an activity ID
 * Used for stream generation where we need per-activity reproducibility
 */
export function createActivitySeededRandom(activityId: string): () => number {
  return createSeededRandom(activityId);
}

/**
 * Deterministic rest day decision based on date
 * Monday: 80% rest, Thursday: 50% rest
 */
export function isRestDay(dateStr: string, dayOfWeek: number): boolean {
  const random = createDateSeededRandom(dateStr + '-rest');
  const value = random();

  if (dayOfWeek === 1) return value < 0.8; // Monday
  if (dayOfWeek === 4) return value < 0.5; // Thursday
  return false;
}

/**
 * Deterministic time-of-day based on date hash
 * Returns hours (7-9) and minutes (0-59)
 */
export function getTimeOfDay(dateStr: string): { hours: number; minutes: number } {
  const random = createDateSeededRandom(dateStr + '-time');
  return {
    hours: 7 + Math.floor(random() * 3),
    minutes: Math.floor(random() * 60),
  };
}

/**
 * Format date as YYYY-MM-DD (local, not UTC)
 */
export function formatDateId(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date as ISO local string (YYYY-MM-DDTHH:mm:ss, no timezone)
 * This ensures dates remain consistent regardless of execution timezone
 */
export function formatLocalISOString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Generate deterministic activity ID
 * Format: demo-YYYY-MM-DD-N where N is a per-day index
 * This ensures stable IDs for testing and deep links
 */
export function generateActivityId(dateStr: string, dayIndex: number): string {
  return `demo-${dateStr}-${dayIndex}`;
}

/**
 * Get the demo reference date as a Date object
 */
export function getDemoReferenceDate(): Date {
  return new Date(DEMO_REFERENCE_DATE + 'T00:00:00');
}

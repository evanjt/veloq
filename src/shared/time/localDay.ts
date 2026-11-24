/**
 * Calendar-day arithmetic on the device clock.
 *
 * This module imports nothing native, so the linked connect page can share it
 * with the app. The local day string is here too, so the connect page never reaches `format`.
 */

/**
 * `date` moved by `days` local calendar days, as a new `Date`. The wall-clock
 * time is kept across a daylight-saving change, and `date` itself is left as it
 * was given.
 */
export function addLocalDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/**
 * Format a date as YYYY-MM-DD using local timezone (not UTC).
 * Use this instead of toISOString().split('T')[0] to avoid timezone issues.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

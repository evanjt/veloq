/**
 * The stream retention window, as the settings screen offers it.
 *
 * The window lives in Rust, where zero means keep everything. This is only
 * the set of values the row cycles through and the rule for reading a
 * value the engine hands back, so the policy stays in one place.
 *
 * This is the only retention the app has. Nothing deletes whole activities by
 * age: the only paths that remove one are the sign-out wipe and the
 * derived-data clear.
 */

/** Keep everything, which is the widest the window goes. */
export const STREAM_RETENTION_ALL = 0;

/**
 * What the engine falls back to when the athlete has never chosen: everything.
 *
 * This was 90. The window was sized against the raw JSON the server sends, and
 * the engine packs it about ten times smaller, so 90 days was discarding the
 * heart rate, power and cadence of every older activity to save about 16 MB on
 * a 1,595-activity library. Those samples are what route matching compares
 * attempts with.
 */
export const DEFAULT_STREAM_RETENTION_DAYS = STREAM_RETENTION_ALL;

/**
 * Four windows and the open one, in the order the row walks them. The default
 * is the last of them, so the cycle passes back through it rather than needing
 * the reset to get there.
 */
export const STREAM_RETENTION_CHOICES_DAYS = [30, 90, 180, 365, STREAM_RETENTION_ALL];

/**
 * The window after this one. A value the engine reports that is not one of the
 * choices, which an older build or a hand-edited setting can produce, walks on
 * to the default rather than sticking.
 */
export function nextStreamRetentionDays(days: number): number {
  const at = STREAM_RETENTION_CHOICES_DAYS.indexOf(days);
  if (at < 0) return DEFAULT_STREAM_RETENTION_DAYS;
  return STREAM_RETENTION_CHOICES_DAYS[(at + 1) % STREAM_RETENTION_CHOICES_DAYS.length];
}

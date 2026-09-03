/**
 * The stream retention window, as the settings screen offers it.
 *
 * `B132` put the window in Rust and made zero mean keep everything. This is
 * only the set of values the row cycles through and the rule for reading a
 * value the engine hands back, so the policy stays in one place.
 *
 * Not the activity `retentionDays` in `RouteSettingsStore`. That one deletes
 * whole activities and nothing here may write it.
 */

/** What the engine falls back to when the athlete has never chosen. */
export const DEFAULT_STREAM_RETENTION_DAYS = 90;

/** Keep everything, which is the widest the window goes. */
export const STREAM_RETENTION_ALL = 0;

/**
 * Four windows and the open one, in the order the row walks them. The default
 * is in the list so the cycle passes back through it rather than needing the
 * reset to get there.
 */
export const STREAM_RETENTION_CHOICES_DAYS = [
  30,
  DEFAULT_STREAM_RETENTION_DAYS,
  180,
  365,
  STREAM_RETENTION_ALL,
];

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

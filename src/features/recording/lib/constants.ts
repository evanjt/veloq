// How long to wait before showing GPS warning banner
export const GPS_WARNING_MS = 20_000;

// How long to wait before showing GPS alert dialog
export const GPS_ALERT_MS = 60_000;

// Crash recovery backup interval (15s to finish before iOS ~30s background limit)
export const BACKUP_INTERVAL_MS = 15_000;

/**
 * How often a live GPS session re-asks whether the location foreground service
 * is running. Short enough that a service which came up a moment late clears its
 * warning while the rider is still reading it, and cheap enough to leave running
 * for the whole ride: one call into `ActivityManager`.
 */
export const SERVICE_WATCH_MS = 3_000;

// Km split banner display duration
export const SPLIT_BANNER_DURATION_MS = 3_000;

// How often the iOS Live Activity card is pushed a fresh payload. ActivityKit
// budgets updates, and a 1 Hz card would spend that budget on a distance that
// changes by metres.
export const LIVE_ACTIVITY_REFRESH_MS = 5_000;

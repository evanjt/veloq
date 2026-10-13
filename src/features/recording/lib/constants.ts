// How long to wait before showing GPS warning banner
export const GPS_WARNING_MS = 20_000;

// How long to wait before showing GPS alert dialog
export const GPS_ALERT_MS = 60_000;

// Crash recovery backup interval (15s to finish before iOS ~30s background limit)
export const BACKUP_INTERVAL_MS = 15_000;

// How long review waits after the last edit before writing the stopped ride's backup
export const REVIEW_BACKUP_DEBOUNCE_MS = 1_000;

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

// How long the Live Activity card stays fresh after a push. Every refresh moves
// it on, so only a process that has stopped refreshing lets the card go stale,
// and a stale card stops its clock and says the recording stopped. The margin
// is wide because a live ride that reads as stopped sends the rider to an app
// that was recording all along.
export const LIVE_ACTIVITY_STALE_MS = LIVE_ACTIVITY_REFRESH_MS * 24;

// How long a stopped ride's card stays on the lock screen with its final
// figures. Long enough for a rider who pockets the phone at the stop to see
// the ride ended and was kept, short of the hours the system would allow.
export const LIVE_ACTIVITY_ENDED_DISMISS_MS = 15 * 60_000;

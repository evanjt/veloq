/**
 * Watching one GPS download run to its end.
 *
 * Rust owns the download and reports a single `active` flag beside the
 * counters, so the only way to know a pass has finished is to poll. The loop
 * used to break on that flag and nothing else. A panic in the fetch thread
 * unwinds that thread alone and the flag stays true for the life of the
 * process, so the poll spun at 10 Hz behind a sync banner that never cleared,
 * and the abort signal ended the poll without ever ending the Rust thread.
 *
 * A guard on the Rust side clears the flag on every way out of that thread, and
 * this carries the other half: a deadline of its own, so the class of stuck
 * download is bounded rather than one instance of it. The deadline is on
 * progress, not on wall clock, because a download of a thousand activities is
 * slow but moving and a download of one that has stopped moving is stuck.
 */

/** What one poll of the engine reports. */
export interface DownloadProgressRead {
  active: boolean;
  completed: number;
  total: number;
}

export type PollOutcome = 'settled' | 'cancelled' | 'stalled';

export interface PollOptions {
  /** Reads the engine's download progress. */
  read: () => DownloadProgressRead;
  /** Called with each reading while the download is still running. */
  onProgress?: (progress: DownloadProgressRead) => void;
  /** Keeps polling only while this reads true. */
  isActive?: () => boolean;
  /** Waits between polls. Defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
  /** Reads the clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Milliseconds between polls. */
  intervalMs?: number;
  /** How long the counters may stand still before the run is called stuck. */
  stallMs?: number;
}

const DEFAULT_INTERVAL_MS = 100;

/**
 * Two minutes without a single activity completing. Long enough that a slow
 * activity behind the governor's back-off is not cut off, short enough that a
 * stranded flag costs one wait rather than the session.
 */
const DEFAULT_STALL_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls until the download settles, the caller goes away, or the counters stop
 * moving for `stallMs`. A stall is reported rather than thrown: the result the
 * engine holds is read the same way afterwards, and it is null when nothing
 * finished, which the caller already handles as a failed pass.
 */
export async function pollDownloadProgress(options: PollOptions): Promise<PollOutcome> {
  const {
    read,
    onProgress,
    isActive = () => true,
    wait = sleep,
    now = Date.now,
    intervalMs = DEFAULT_INTERVAL_MS,
    stallMs = DEFAULT_STALL_MS,
  } = options;

  let lastMoved = now();
  let lastCompleted = -1;
  let lastTotal = -1;

  while (isActive()) {
    await wait(intervalMs);
    if (!isActive()) return 'cancelled';

    const progress = read();
    if (!progress.active) return 'settled';

    if (progress.completed !== lastCompleted || progress.total !== lastTotal) {
      lastCompleted = progress.completed;
      lastTotal = progress.total;
      lastMoved = now();
    } else if (now() - lastMoved >= stallMs) {
      return 'stalled';
    }

    onProgress?.(progress);
  }

  return 'cancelled';
}

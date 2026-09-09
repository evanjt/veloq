/**
 * Following a detection run to its end.
 *
 * Rust announces every run's end on `detectionApplied`, once, on every exit
 * path including a worker that dies, so the terminal status is read on that
 * event and nowhere else. What stays on a timer is progress, which has no
 * event to carry it: `increment` runs once per item and the binding blocks
 * the Rust thread until JavaScript returns. The timer therefore reads only
 * `getSectionDetectionProgress`, one mutex and three atomic loads, which
 * never drains the worker's channel and so cannot consume the completion the
 * event reports.
 *
 * The one case where the timer does read the status is an engine that says it
 * cannot announce. Registering the observer is withheld when the binding's
 * checksum check throws, and then no event ever arrives, so following one is
 * following nothing.
 */

/** The channel Rust announces a finished run on. */
const CHANNEL = 'detectionApplied';

const DEFAULT_PROGRESS_INTERVAL_MS = 500;

/**
 * How long a run is followed before the surface says it is taking a while.
 *
 * Two budgets rather than one, because a long detect is normal and a detect
 * that will never end is not, and the athlete needs telling apart. Shared by
 * every follower so the same run is judged the same way whichever screen
 * started it.
 */
export const DETECTION_FOREGROUND_MS = 120000;

/**
 * How long a run is followed at all. The engine caps its own wait on the
 * detection slot at the same 420 seconds (`SLOT_WAIT_LIMIT`), so a follower
 * that gave up sooner would call a run dead that the engine is still waiting
 * on, and one that waited longer would be waiting on nothing.
 */
export const DETECTION_FOLLOW_MS = 420000;

export type DetectionOutcome = 'complete' | 'idle' | 'error' | 'timeout' | 'abandoned';

export interface DetectionProgress {
  phase: string;
  completed: number;
  total: number;
  percent: number;
}

/** The engine surface a follower needs, so any caller's handle fits. */
export interface DetectionEngine {
  subscribe(event: string, listener: () => void): () => void;
  pollSectionDetection(): string;
  getSectionDetectionProgress(): DetectionProgress | null | undefined;
  /** False when the observer was withheld, so nothing will ever announce. */
  eventsAreLive?(): boolean;
}

/**
 * Whether the event is worth waiting for.
 *
 * A handle that cannot say is taken as able to announce, which is what every
 * handle did before this existed. A handle that throws is not: a host that
 * cannot answer a local read is not one to stake a spinner on.
 */
function canAnnounce(engine: DetectionEngine): boolean {
  if (!engine.eventsAreLive) return true;
  try {
    return engine.eventsAreLive();
  } catch {
    return false;
  }
}

export interface FollowOptions {
  /** Called on every tick while the run is still going. */
  onProgress?: (progress: DetectionProgress) => void;
  progressIntervalMs?: number;
  /** Answers 'timeout' rather than following for ever. */
  timeoutMs?: number;
  /** Called once when the run outlives `lapseAfterMs`, still following. */
  onLapse?: () => void;
  lapseAfterMs?: number;
  /** Stops following, answering 'abandoned', as soon as this reads false. */
  isActive?: () => boolean;
}

function terminal(status: string): DetectionOutcome | null {
  if (status === 'complete' || status === 'idle' || status === 'error') return status;
  return null;
}

export interface DetectionFollow {
  /** Resolves once the run ends, or once one of the budgets runs out. */
  settled: Promise<DetectionOutcome>;
  /** Drops the subscription and the timers now, answering 'abandoned'. */
  cancel: () => void;
}

/**
 * Follows a run until it ends.
 *
 * The subscription is taken before the first read, so a run that ends in
 * between is still caught by that read rather than waited on for ever.
 */
export function followDetection(
  engine: DetectionEngine,
  options: FollowOptions = {}
): DetectionFollow {
  const {
    onProgress,
    progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
    timeoutMs,
    onLapse,
    lapseAfterMs,
    isActive,
  } = options;

  let cancel = () => {};
  const settled = new Promise<DetectionOutcome>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let ticker: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let lapseTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (outcome: DetectionOutcome) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      if (ticker) clearInterval(ticker);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (lapseTimer) clearTimeout(lapseTimer);
      resolve(outcome);
    };

    // Read the terminal status once, on the event. A host that cannot answer
    // must not leave the caller following a run that has already ended.
    const readTerminal = () => {
      let status = 'error';
      try {
        status = engine.pollSectionDetection();
      } catch {
        status = 'error';
      }
      const outcome = terminal(status);
      if (outcome) settle(outcome);
      return outcome;
    };

    try {
      unsubscribe = engine.subscribe(CHANNEL, readTerminal);
    } catch {
      unsubscribe = null;
    }

    cancel = () => settle('abandoned');

    if (readTerminal()) return;

    // Rust announces the end on every exit path, so the status is read on the
    // event and not on the timer. That holds only while the observer is
    // registered: when it was withheld, the announcement never comes and this
    // is the only thing left that can end the run.
    const pollsTerminal = !canAnnounce(engine);

    ticker = setInterval(() => {
      if (isActive && !isActive()) {
        settle('abandoned');
        return;
      }
      if (pollsTerminal && readTerminal()) return;
      if (!onProgress) return;
      try {
        const progress = engine.getSectionDetectionProgress();
        if (progress) onProgress(progress);
      } catch {
        // A read that cannot answer costs the bar a tick, not the run.
      }
    }, progressIntervalMs);

    if (timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => settle('timeout'), timeoutMs);
    }
    if (onLapse && lapseAfterMs !== undefined) {
      lapseTimer = setTimeout(onLapse, lapseAfterMs);
    }
  });

  return { settled, cancel };
}

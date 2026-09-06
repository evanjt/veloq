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
 */

/** The channel Rust announces a finished run on. */
const CHANNEL = 'detectionApplied';

const DEFAULT_PROGRESS_INTERVAL_MS = 500;

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

    ticker = setInterval(() => {
      if (isActive && !isActive()) {
        settle('abandoned');
        return;
      }
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

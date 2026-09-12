/**
 * One attempt at bringing the engine up, and the token that ends it.
 *
 * The launch effect re-runs whenever the athlete taps retry, and its init chain
 * is asynchronous: a failed open waits half a second on a timer, and an
 * identity mismatch waits on a dialog. Either can still be in flight when the
 * next run starts, so without a token both chains reach the success block and
 * launch asks the same questions twice.
 */

export interface EngineInitRun {
  /** False once the effect that owns this run has been cleaned up. */
  readonly live: boolean;
  /** Schedule the next attempt. A run that is no longer live schedules nothing. */
  retryAfter(ms: number, attempt: () => void): void;
  /** End the run and drop any attempt still waiting on the timer. */
  cancel(): void;
}

export function startEngineInitRun(): EngineInitRun {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    get live() {
      return live;
    },
    retryAfter(ms, attempt) {
      if (!live) return;
      timer = setTimeout(() => {
        timer = null;
        if (live) attempt();
      }, ms);
    },
    cancel() {
      live = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** What one attempt at opening the library came to. */
export type EngineInitAttempt =
  /** The library is open and launch has taken it from there. */
  | 'settled'
  /** The athlete has been asked whose library this is. Nothing retries a question. */
  | 'waiting'
  /** The open failed. Retryable outcomes get one more try. */
  | 'failed';

interface EngineInitSteps {
  attempt: (attemptNo: number) => Promise<EngineInitAttempt>;
  /** Whether the last outcome is one that lifts on its own. */
  retryable: () => boolean;
  /** Nothing left to try: tell the athlete what stopped it. */
  giveUp: () => void;
}

/** Attempts past the first. A held file lifts in half a second or it does not. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

/**
 * Open the library, retrying once through `run` so a cleanup drops the pending
 * attempt rather than letting it reach the success block behind a newer run.
 */
export async function runEngineInit(
  run: EngineInitRun,
  steps: EngineInitSteps,
  attemptNo = 0
): Promise<void> {
  const outcome = await steps.attempt(attemptNo);
  if (!run.live) return;
  if (outcome !== 'failed') return;

  if (attemptNo + 1 < MAX_ATTEMPTS && steps.retryable()) {
    run.retryAfter(RETRY_DELAY_MS, () => void runEngineInit(run, steps, attemptNo + 1));
    return;
  }
  steps.giveUp();
}

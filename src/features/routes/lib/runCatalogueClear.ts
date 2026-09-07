/**
 * Await the derived-catalogue wipe that runs on a Rust thread.
 *
 * Turning route matching off wipes every detected route and section. Measured
 * at a 750-activity library that takes 367 ms, and it held the engine write
 * lock on the JS thread, so the switch the athlete flipped froze the app. Rust
 * runs it on its own thread now and this only polls the outcome.
 */

/** Cheap enough to poll at, short enough that a small wipe still returns promptly. */
const POLL_INTERVAL_MS = 50;

/** A wipe that has not finished by here is stuck, not slow. */
const CLEAR_TIMEOUT_MS = 2 * 60 * 1000;

export interface CatalogueClearEngine {
  startClearRoutesAndSections(): void;
  pollClearRoutesAndSections(): string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runCatalogueClear(
  engine: CatalogueClearEngine,
  timeoutMs: number = CLEAR_TIMEOUT_MS
): Promise<void> {
  engine.startClearRoutesAndSections();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await wait(POLL_INTERVAL_MS);
    // A failed wipe throws out of the poll, carrying the Rust message.
    const state = engine.pollClearRoutesAndSections();
    if (state === 'complete') return;
    if (state !== 'running') {
      throw new Error(`Catalogue clear stopped without finishing (${state})`);
    }
    if (Date.now() > deadline) {
      throw new Error('Catalogue clear did not finish in time');
    }
  }
}

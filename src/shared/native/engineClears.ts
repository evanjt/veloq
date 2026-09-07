/**
 * Await a wipe that runs on a Rust thread.
 *
 * Two of them do: the derived catalogue when route matching is turned off, and
 * the clear-cache button. Both take the engine write lock over every table,
 * and on a 750-activity library they cost 367 ms and 734 ms. On the JavaScript
 * thread that is a control the athlete touched that then freezes the app for
 * as long as the wipe runs. Rust runs them on its own thread now and these
 * only poll the outcome.
 *
 * One poll loop rather than two: the states, the interval and the timeout are
 * the same question in both.
 *
 * The third wipe, the whole-database one behind "Clear & Sync", waits inside
 * `EngineClient.clear` rather than here. It has to re-open the engine when the
 * wipe lands, and the module cannot import this file: nothing under
 * `modules/veloqrs` may reach into `src/`.
 *
 * Shared and not under a feature: the clear-cache button is `activity`'s and
 * the detection switch is `routes`', so either home is a cross-feature import.
 */

/** Cheap enough to poll at, short enough that a small wipe still returns promptly. */
const POLL_INTERVAL_MS = 50;

/** A wipe that has not finished by here is stuck, not slow. */
const CLEAR_TIMEOUT_MS = 2 * 60 * 1000;

export interface CatalogueClearEngine {
  startClearRoutesAndSections(): void;
  pollClearRoutesAndSections(): string;
}

/** What the clear-cache wipe removed, once it reports complete. */
export interface DerivedClearResult {
  sectionsRemoved: number;
  activitiesRemoved: number;
  activitiesKept: number;
}

export interface DerivedClearEngine {
  startClearDerived(): void;
  pollClearDerived(): DerivedClearResult & { state: string };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `read` until it reports complete, then hand back what it last read.
 *
 * `label` names the wipe in the two failures a caller can act on: one that
 * stopped without finishing, and one that never finished at all. A failed
 * wipe throws out of the poll instead, carrying the Rust message.
 */
async function awaitClear<T extends { state: string }>(
  label: string,
  start: () => void,
  read: () => T,
  timeoutMs: number
): Promise<T> {
  start();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await wait(POLL_INTERVAL_MS);
    const poll = read();
    if (poll.state === 'complete') return poll;
    if (poll.state !== 'running') {
      throw new Error(`${label} stopped without finishing (${poll.state})`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} did not finish in time`);
    }
  }
}

/** The derived catalogue, wiped when route matching is turned off. */
export async function runCatalogueClear(
  engine: CatalogueClearEngine,
  timeoutMs: number = CLEAR_TIMEOUT_MS
): Promise<void> {
  await awaitClear(
    'Catalogue clear',
    () => engine.startClearRoutesAndSections(),
    () => ({ state: engine.pollClearRoutesAndSections() }),
    timeoutMs
  );
}

/** Everything the engine can re-derive: the clear-cache button's database half. */
export async function runDerivedClear(
  engine: DerivedClearEngine,
  timeoutMs: number = CLEAR_TIMEOUT_MS
): Promise<DerivedClearResult> {
  const { sectionsRemoved, activitiesRemoved, activitiesKept } = await awaitClear(
    'Cache clear',
    () => engine.startClearDerived(),
    () => engine.pollClearDerived(),
    timeoutMs
  );
  return { sectionsRemoved, activitiesRemoved, activitiesKept };
}

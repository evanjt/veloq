/**
 * Await a wipe that runs on a Rust thread.
 *
 * Two of them do: the derived catalogue when route matching is turned off, and
 * the clear-cache button. Both take the engine write lock over every table,
 * and on a 750-activity library they cost 367 ms and 734 ms. On the JavaScript
 * thread that is a control the athlete touched that then freezes the app for
 * as long as the wipe runs. Rust runs them on its own thread and answers with
 * a Promise, and these two put the session's ceiling on the wait.
 *
 * One ceiling rather than two: the budget and the still-running answer are the
 * same question in both.
 *
 * The third wipe, the whole-database one behind "Clear & Sync", waits inside
 * `EngineClient.clear` rather than here. It has to re-open the engine when the
 * wipe lands, and the module cannot import this file: nothing under
 * `modules/veloqrs` may reach into `src/`.
 *
 * Shared and not under a feature: the clear-cache button is `activity`'s and
 * the detection switch is `routes`', so either home is a cross-feature import.
 */
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

/**
 * How long a caller watches a wipe. Past it the wipe is still going on its own
 * thread and the screen says so: the measured cost is under a second on a full
 * library, so a minute of watching is already generous.
 */
const CLEAR_TIMEOUT_MS = 60 * 1000;

export interface CatalogueClearEngine {
  runClearRoutesAndSections(): Promise<void>;
}

/** What the clear-cache wipe removed. */
export interface DerivedClearResult {
  sectionsRemoved: number;
  activitiesRemoved: number;
  activitiesKept: number;
}

export interface DerivedClearEngine {
  runClearDerived(): Promise<DerivedClearResult>;
}

/**
 * How a caller's watch on a wipe ended.
 *
 * `stillRunning` is not a failure: the budget is the caller's and Rust keeps
 * wiping past it, so the screen says the wipe is still going rather than
 * calling it stuck. A wipe that stopped without finishing rejects instead,
 * carrying the Rust message.
 */
export type ClearOutcome<T> = { state: 'complete'; removed: T } | { state: 'stillRunning' };

/**
 * The clear-cache wipe's watch. Past the cap it also hands back the wipe
 * itself, because the re-cut owed after it has to follow it whenever it lands
 * and not only when it lands inside the caller's wait.
 */
export type DerivedClearOutcome =
  | { state: 'complete'; removed: DerivedClearResult }
  | { state: 'stillRunning'; landing: Promise<DerivedClearResult> };

/** The derived catalogue, wiped when route matching is turned off. */
export async function runCatalogueClear(
  engine: CatalogueClearEngine,
  timeoutMs: number = CLEAR_TIMEOUT_MS
): Promise<ClearOutcome<void>> {
  const outcome = await withAwakeDeadline(engine.runClearRoutesAndSections(), timeoutMs);
  return outcome.state === 'complete'
    ? { state: 'complete', removed: undefined }
    : { state: 'stillRunning' };
}

/** Everything the engine can re-derive: the clear-cache button's database half. */
export async function runDerivedClear(
  engine: DerivedClearEngine,
  timeoutMs: number = CLEAR_TIMEOUT_MS
): Promise<DerivedClearOutcome> {
  const wipe = engine.runClearDerived();
  const outcome = await withAwakeDeadline(wipe, timeoutMs);
  if (outcome.state === 'stillRunning') return { state: 'stillRunning', landing: wipe };
  const { sectionsRemoved, activitiesRemoved, activitiesKept } = outcome.value;
  return { state: 'complete', removed: { sectionsRemoved, activitiesRemoved, activitiesKept } };
}

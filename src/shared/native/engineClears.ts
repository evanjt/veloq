/**
 * Await a wipe that runs on a Rust thread.
 *
 * The clear-cache button's wipe takes the engine write lock over every table,
 * and on a 750-activity library it costs 734 ms. On the JavaScript thread that
 * is a control the athlete touched that then freezes the app for as long as the
 * wipe runs. Rust runs it on its own thread and answers with a Promise, and
 * this puts the session's ceiling on the wait.
 *
 * The whole-database wipe behind "Clear & Sync" waits inside
 * `EngineClient.clear` rather than here. It has to re-open the engine when the
 * wipe lands, and the module cannot import this file: nothing under
 * `modules/veloqrs` may reach into `src/`.
 */
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

/**
 * How long a caller watches a wipe. Past it the wipe is still going on its own
 * thread and the screen says so: the measured cost is under a second on a full
 * library, so a minute of watching is already generous.
 */
const CLEAR_TIMEOUT_MS = 60 * 1000;

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
 * The clear-cache wipe's watch. Past the cap it also hands back the wipe
 * itself, because the re-cut owed after it has to follow it whenever it lands
 * and not only when it lands inside the caller's wait.
 */
export type DerivedClearOutcome =
  | { state: 'complete'; removed: DerivedClearResult }
  | { state: 'stillRunning'; landing: Promise<DerivedClearResult> };

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

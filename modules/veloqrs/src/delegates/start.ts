/**
 * The verdict every start answers with.
 *
 * A start that answers with a bare boolean tells a caller nothing it can act
 * on: "the slot is held for a moment" and "there is no credential, this will
 * never work" arrive as the same `false`. So retries were wired to whatever
 * external edge might correlate with the cause, a reconnect or a foreground,
 * and a refusal nobody could classify became a screen that quietly stayed
 * empty.
 *
 * `FfiStartOutcome` comes from Rust and names the reason. These two helpers are
 * the only place that turns a reason into a decision, so no caller re-derives
 * it and the TypeScript-only starts, which have no engine call to make, answer
 * with the same vocabulary.
 */

import { FfiStartOutcome } from '../generated/veloqrs';

/** Whether asking again later can change the answer. Never true once started. */
export function isRetryableStart(outcome: FfiStartOutcome): boolean {
  return (
    outcome === FfiStartOutcome.Busy ||
    outcome === FfiStartOutcome.Held ||
    outcome === FfiStartOutcome.NotReady ||
    outcome === FfiStartOutcome.Offline
  );
}

/** Whether the job is now running. */
export function hasStarted(outcome: FfiStartOutcome): boolean {
  return outcome === FfiStartOutcome.Started;
}

/**
 * Why the engine did not open.
 *
 * `initWithPath` answers whether the engine is usable, which is what its
 * callers need. This is the other half: a database written by a newer build, a
 * file another connection held, and a directory nothing can be written to are
 * three different problems with three different remedies, and the banner said
 * the same sentence for all of them.
 *
 * `FfiInitOutcome` comes from Rust. This is the only place that turns one into
 * a decision, so no caller re-derives it, and it is where a throw at the FFI
 * boundary becomes a reason rather than another bare `false`.
 */

import { FfiInitOutcome } from '../generated/veloqrs';

/** Whether opening again later can change the answer. */
export function isRetryableInit(outcome: FfiInitOutcome): boolean {
  return outcome === FfiInitOutcome.Busy;
}

/** Whether the engine is usable. */
export function hasOpened(outcome: FfiInitOutcome): boolean {
  return outcome === FfiInitOutcome.Opened;
}

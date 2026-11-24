/**
 * The engine's announcement channel for stored bodies, and what a payload names.
 *
 * `bodyStored` is the channel an on-demand body lands on, and its payload
 * carries the kind of body that landed. Readers used to spell the channel and
 * read the kind for themselves. This module is the one spelling of both, and it
 * imports nothing, so a consumer that only needs the string does not pull the
 * static native binding in.
 */

export const BODY_STORED_CHANNEL = 'bodyStored';

/** The `kind` an announcement names, or undefined when it names none. */
export function payloadKind(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const { kind } = payload as { kind?: unknown };
  return typeof kind === 'string' ? kind : undefined;
}

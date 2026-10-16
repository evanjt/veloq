/**
 * Bind a delegate module to the engine host.
 *
 * Every delegate takes the host as its first argument. Bound, a module reads
 * as the namespace a component calls, `elevation.pauseElevationBackfill()`,
 * with no forward on the client in between. The host is read at each call, not
 * captured, so a binding made at module load sees the engine open later.
 *
 * Each function stays total: before the engine opens it answers the delegate's
 * typed default, so a call site carries no null check of its own.
 */

import type { DelegateHost } from './host';

/** A module's host-taking functions, with the host argument removed. */
export type Bound<M> = {
  [K in keyof M as M[K] extends (host: DelegateHost, ...args: never[]) => unknown
    ? K
    : never]: M[K] extends (host: DelegateHost, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

export function bindDelegates<M extends object>(host: DelegateHost, delegates: M): Bound<M> {
  const bound: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(delegates)) {
    if (typeof value === 'function') {
      bound[name] = (...args: unknown[]) => value(host, ...args);
    }
  }
  return bound as Bound<M>;
}

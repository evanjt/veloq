/**
 * The connectivity state TypeScript pushes into Rust.
 *
 * Nothing in the crate can see the network, so this is the whole of its
 * input. `Q65` put the network lifecycle in Rust on the condition that the
 * state come from the one place TypeScript already computes it, so there is
 * one debounce and one edge rather than two.
 *
 * Unlike the rest of the delegates these do not guard on `host.ready`: the
 * exports are free functions over a process-wide value, not engine methods,
 * so a push before `initWithPath` is still worth landing.
 */

import {
  setNetworkOnline as ffiSetNetworkOnline,
  getNetworkPush as ffiGetNetworkPush,
  type NetworkPush,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

export type { NetworkPush };

/**
 * Tell Rust what the network looks like. Call on every transition and on
 * foreground. The value is advisory in Rust and expires, so a dropped push
 * costs a deferred pass at worst, never a stranded queue.
 */
export function setNetworkOnline(host: DelegateHost, online: boolean): void {
  try {
    host.timed('setNetworkOnline', () => ffiSetNetworkOnline(online));
  } catch (e) {
    console.error('[Engine] setNetworkOnline threw:', e);
  }
}

/** What was last pushed and how old it is. Null when nothing has been. */
export function getNetworkPush(host: DelegateHost): NetworkPush | null {
  try {
    return host.timed('getNetworkPush', () => ffiGetNetworkPush() ?? null);
  } catch (e) {
    console.error('[Engine] getNetworkPush threw:', e);
    return null;
  }
}

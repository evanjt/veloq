/**
 * Route-grouping preview client seam.
 *
 * The Rust RouteGroupingPreview object groups the whole library at a chosen
 * strictness without writing anything, so the knob can be shown before it is
 * applied. This module owns the client interface the strictness control codes
 * against; the screen lands with the control itself.
 */

import { RouteGroupingPreview } from '../generated/veloqrs';
import type { RouteGroupingPreviewLike } from '../generated/veloqrs';
import type { DelegateHost } from './host';

export interface RouteGroupPreview {
  /**
   * The grouping's own key for this group. Not a stable route id: the preview
   * never runs the identity remap that assigns one, so this joins rows within
   * one payload and must never be persisted or matched against a route id.
   */
  key: string;
  /** Member activity ids, sorted. */
  activityIds: string[];
}

export type RouteGroupingPollStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

/** The surface the strictness control talks to. */
export interface RouteGroupingPreviewClient {
  startRouteGroupingPreview(minMatchPercentage: number, endpointThreshold: number): boolean;
  pollRouteGroupingPreview(): RouteGroupingPollStatus;
  takeRouteGroupingPreviewResult(): RouteGroupPreview[] | null;
  cancelRouteGroupingPreview(): void;
}

let previewObject: RouteGroupingPreviewLike | null = null;

/** One handle per JS runtime; the Rust side is a thin facade over one slot. */
function previewObj(): RouteGroupingPreviewLike {
  if (!previewObject) previewObject = new RouteGroupingPreview();
  return previewObject;
}

/**
 * Group the whole library at this strictness. False when a preview is already
 * running or the library has no signatures to group.
 */
export function startRouteGroupingPreview(
  host: DelegateHost,
  minMatchPercentage: number,
  endpointThreshold: number
): boolean {
  if (!host.ready) return false;
  try {
    return host.timed('startRouteGroupingPreview', () =>
      previewObj().start(minMatchPercentage, endpointThreshold)
    );
  } catch (e) {
    console.error('[Engine] startRouteGroupingPreview threw:', e);
    return false;
  }
}

export function pollRouteGroupingPreview(host: DelegateHost): RouteGroupingPollStatus {
  if (!host.ready) return 'idle';
  try {
    return host.timed('pollRouteGroupingPreview', () =>
      previewObj().poll()
    ) as RouteGroupingPollStatus;
  } catch (e) {
    console.error('[Engine] pollRouteGroupingPreview threw:', e);
    return 'error';
  }
}

/** Take the one payload. Null while running or after taken. */
export function takeRouteGroupingPreviewResult(host: DelegateHost): RouteGroupPreview[] | null {
  if (!host.ready) return null;
  try {
    const groups = host.timed('takeRouteGroupingPreviewResult', () => previewObj().takeResult());
    return groups ? groups.map((g) => ({ key: g.key, activityIds: g.activityIds })) : null;
  } catch (e) {
    console.error('[Engine] takeRouteGroupingPreviewResult threw:', e);
    return null;
  }
}

/**
 * Cooperative. The grouping is one engine call and cannot be interrupted, so a
 * cancel that arrives inside it discards the result rather than shortening the
 * run.
 */
export function cancelRouteGroupingPreview(host: DelegateHost): void {
  if (!host.ready) return;
  try {
    host.timed('cancelRouteGroupingPreview', () => previewObj().cancel());
  } catch (e) {
    console.error('[Engine] cancelRouteGroupingPreview threw:', e);
  }
}

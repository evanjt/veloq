/**
 * Route-grouping preview client seam.
 *
 * The Rust RouteGroupingPreview object groups the whole library at a chosen
 * strictness without writing anything, so the knob can be shown before it is
 * applied. This module owns the client interface the strictness control codes
 * against; the screen lands with the control itself.
 */

import { RouteGroupingPreview, FfiGroupingOutcome_Tags } from '../generated/veloqrs';
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

/**
 * How one run ended.
 *
 * `cancelled` is the ordinary end of a run rather than a failure: every knob
 * movement supersedes the one in flight. `refused` is a library with no
 * signatures to group. A run already going is cancelled and waited out by the
 * engine, so it never reads as a refusal.
 */
export type RouteGroupingOutcome =
  | { state: 'grouped'; groups: RouteGroupPreview[] }
  | { state: 'cancelled' }
  | { state: 'refused' };

/** The surface the strictness control talks to. */
export interface RouteGroupingPreviewClient {
  runRouteGroupingPreview(
    minMatchPercentage: number,
    endpointThreshold: number
  ): Promise<RouteGroupingOutcome>;
  cancelRouteGroupingPreview(): void;
}

let previewObject: RouteGroupingPreviewLike | null = null;

/** One handle per JS runtime; the Rust side is a thin facade over one slot. */
function previewObj(): RouteGroupingPreviewLike {
  if (!previewObject) previewObject = new RouteGroupingPreview();
  return previewObject;
}

/**
 * Group the whole library at this strictness, resolving with what it found.
 *
 * A failure inside the engine reads as a refusal rather than throwing: the
 * screen's move is the same either way, which is to paint nothing and leave the
 * knob where the athlete put it.
 */
export async function runRouteGroupingPreview(
  host: DelegateHost,
  minMatchPercentage: number,
  endpointThreshold: number
): Promise<RouteGroupingOutcome> {
  if (!host.ready) return { state: 'refused' };
  try {
    const outcome = await previewObj().run(minMatchPercentage, endpointThreshold);
    switch (outcome.tag) {
      case FfiGroupingOutcome_Tags.Grouped:
        return {
          state: 'grouped',
          groups: outcome.inner.groups.map((g) => ({ key: g.key, activityIds: g.activityIds })),
        };
      case FfiGroupingOutcome_Tags.Cancelled:
        return { state: 'cancelled' };
      default:
        return { state: 'refused' };
    }
  } catch (e) {
    console.error('[Engine] runRouteGroupingPreview threw:', e);
    return { state: 'refused' };
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

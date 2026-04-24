/**
 * Section bounds delegates.
 *
 * Geometry editing for existing sections: trim to a narrower sub-range, reset
 * back to the original polyline, or expand to a user-supplied wider polyline.
 * Each edit re-matches activities and fans out change events via `notifyAll`
 * because both summaries and polylines can change.
 */

import { validateId } from '../../conversions';
import type { DelegateHost } from '../host';

export function trimSection(
  host: DelegateHost,
  sectionId: string,
  startIndex: number,
  endIndex: number
): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('trimSection', () => host.engine.sections().trim(sectionId, startIndex, endIndex));
    host.notifyAll('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] trimSection failed:', sectionId, { startIndex, endIndex }, e);
    return false;
  }
}

export function resetSectionBounds(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('resetSectionBounds', () => host.engine.sections().resetBounds(sectionId));
    host.notifyAll('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] resetSectionBounds failed:', sectionId, e);
    return false;
  }
}

/**
 * Expand section bounds by providing a new polyline (can be larger than original).
 * Backs up original polyline on first edit, re-matches activities.
 */
export function expandSectionBounds(
  host: DelegateHost,
  sectionId: string,
  newPolylineJson: string
): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('expandSectionBounds', () =>
      host.engine.sections().expandBounds(sectionId, newPolylineJson)
    );
    host.notifyAll('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] expandSectionBounds failed:', sectionId, e);
    return false;
  }
}

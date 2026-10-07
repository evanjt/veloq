/**
 * Section bounds delegates.
 *
 * Geometry editing for existing sections: trim to a narrower sub-range, reset
 * back to the original polyline, or expand to a user-supplied wider polyline.
 * Each edit re-matches activities and fans out change events via `notifyAll`
 * because both summaries and polylines can change. Each returns the rides the
 * edit took out of the section, or null when it failed.
 */

import { validateId } from '../../conversions';
import type { FfiDepartedRide } from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

export function trimSection(
  host: DelegateHost,
  sectionId: string,
  startIndex: number,
  endIndex: number
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  try {
    const departed = host.timed('trimSection', () =>
      host.engine.sections().trim(sectionId, startIndex, endIndex)
    );
    host.notifyAll('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] trimSection failed:', sectionId, { startIndex, endIndex }, e);
    return null;
  }
}

export function resetSectionBounds(
  host: DelegateHost,
  sectionId: string
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  try {
    const departed = host.timed('resetSectionBounds', () =>
      host.engine.sections().resetBounds(sectionId)
    );
    host.notifyAll('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] resetSectionBounds failed:', sectionId, e);
    return null;
  }
}

/**
 * Expand section bounds to a wider range of the source activity's GPS track.
 * Backs up original polyline on first edit, re-matches activities.
 */
export function expandSectionBounds(
  host: DelegateHost,
  sectionId: string,
  activityId: string,
  startIndex: number,
  endIndex: number
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  validateId(activityId, 'activity ID');
  try {
    const departed = host.timed('expandSectionBounds', () =>
      host.engine.sections().expandBounds(sectionId, activityId, startIndex, endIndex)
    );
    host.notifyAll('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error(
      '[Engine] expandSectionBounds failed:',
      sectionId,
      { activityId, startIndex, endIndex },
      e
    );
    return null;
  }
}

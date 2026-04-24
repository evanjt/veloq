/**
 * Section mutation delegates.
 *
 * CRUD-style changes: rename, create from GPS slice, delete, set/reset
 * reference activity, rematch a single activity, merge two sections, and
 * recompute activity indicators. Every successful call emits the 'sections'
 * notification so cached summaries refresh.
 */

import { validateId, validateName } from '../../conversions';
import type { FfiGpsPoint } from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

export function setSectionName(host: DelegateHost, sectionId: string, name: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  validateName(name, 'section name');
  try {
    host.timed('setSectionName', () => host.engine.sections().setName(sectionId, name));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] setSectionName failed:', sectionId, e);
    return false;
  }
}

/**
 * Build a new custom section from a slice of an activity's GPS track.
 * The caller must provide `getGpsTrack` (the facade supplies it) so this
 * delegate doesn't need to duplicate the activity lookup logic.
 */
export function createSectionFromIndices(
  host: DelegateHost,
  activityId: string,
  startIndex: number,
  endIndex: number,
  sportType: string,
  name: string | undefined,
  getGpsTrack: (activityId: string) => FfiGpsPoint[]
): string {
  if (!host.ready) return '';
  validateId(activityId, 'activity ID');

  const track = getGpsTrack(activityId);
  if (!track || track.length === 0) {
    throw new Error(`No GPS track found for activity ${activityId}`);
  }

  const sectionTrack = track.slice(startIndex, endIndex + 1);
  if (sectionTrack.length < 2) {
    throw new Error('Section must have at least 2 points');
  }

  const sectionId = host.timed('createSection', () =>
    host.engine
      .sections()
      .create(sportType, sectionTrack, 0.0, name || undefined, activityId, startIndex, endIndex)
  );

  if (sectionId) {
    host.notify('sections');
  }

  return sectionId;
}

export function deleteSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('deleteSection', () => host.engine.sections().delete_(sectionId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] deleteSection failed:', sectionId, e);
    return false;
  }
}

export function setSectionReference(
  host: DelegateHost,
  sectionId: string,
  activityId: string
): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  validateId(activityId, 'activity ID');
  try {
    host.timed('setSectionReference', () =>
      host.engine.sections().setReference(sectionId, activityId)
    );
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] setSectionReference failed:', sectionId, activityId, e);
    return false;
  }
}

export function resetSectionReference(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('resetSectionReference', () => host.engine.sections().resetReference(sectionId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] resetSectionReference failed:', sectionId, e);
    return false;
  }
}

export function rematchActivityToSection(
  host: DelegateHost,
  activityId: string,
  sectionId: string
): boolean {
  if (!host.ready) return false;
  validateId(activityId, 'activity ID');
  validateId(sectionId, 'section ID');
  try {
    const result = host.timed('rematchActivityToSection', () =>
      host.engine.sections().rematchActivityToSection(activityId, sectionId)
    );
    if (result) {
      host.notify('sections');
    }
    return result;
  } catch (e) {
    console.error('[RouteEngine] rematchActivityToSection failed:', e);
    return false;
  }
}

export function mergeSections(
  host: DelegateHost,
  primaryId: string,
  secondaryId: string
): string | null {
  if (!host.ready) return null;
  validateId(primaryId, 'primary section ID');
  validateId(secondaryId, 'secondary section ID');
  try {
    const result = host.timed('mergeSections', () =>
      host.engine.sections().mergeSections(primaryId, secondaryId)
    );
    host.notify('sections');
    return result;
  } catch (e) {
    console.error('[RouteEngine] mergeSections failed:', e);
    return null;
  }
}

export function acceptSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('acceptSection', () => host.engine.sections().accept(sectionId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[RouteEngine] acceptSection failed:', sectionId, e);
    return false;
  }
}

export function acceptAllSections(host: DelegateHost): number {
  if (!host.ready) return 0;
  try {
    const count = host.timed('acceptAllSections', () => host.engine.sections().acceptAll());
    host.notify('sections');
    return count;
  } catch (e) {
    console.error('[RouteEngine] acceptAllSections failed:', e);
    return 0;
  }
}

export function pruneOverlappingSections(host: DelegateHost): number {
  if (!host.ready) return 0;
  try {
    const count = host.timed('pruneOverlappingSections', () =>
      host.engine.sections().pruneOverlapping()
    );
    host.notify('sections');
    return count;
  } catch (e) {
    console.error('[RouteEngine] pruneOverlappingSections failed:', e);
    return 0;
  }
}

/** Recompute all activity indicators (PRs and trends). */
export function recomputeIndicators(host: DelegateHost): void {
  if (!host.ready) return;
  host.timed('recomputeIndicators', () => host.engine.sections().recomputeIndicators());
}

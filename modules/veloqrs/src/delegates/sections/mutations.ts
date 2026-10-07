/**
 * Section mutation delegates.
 *
 * CRUD-style changes: rename, create from GPS slice, delete, set/reset
 * reference activity, rematch a single activity, merge two sections, and
 * recompute activity indicators. Every successful call emits the 'sections'
 * notification so cached summaries refresh.
 */

import { validateId, validateName } from '../../conversions';
import type {
  FfiDepartedRide,
  FfiIndexActivitySummary,
  FfiMergeDropped,
  FfiMergeOutcome,
} from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

/**
 * Mark or unmark a section as a lift.
 *
 * The unmark is durable in Rust: `isLift` is re-derived on every enrichment
 * pass, so the engine writes an intent as well as the column. Nothing here has
 * to remember that, but a caller expecting a column write will be surprised by
 * how long it lasts.
 */
export function setSectionIsLift(host: DelegateHost, sectionId: string, isLift: boolean): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('setSectionIsLift', () => host.engine.sections().setIsLift(sectionId, isLift));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] setSectionIsLift failed:', sectionId, e);
    return false;
  }
}

export type SetSectionNameOutcome = 'saved' | 'nameTaken' | 'failed';

/** The engine's refusal text for a name another section already shows. */
const NAME_TAKEN_MESSAGE = 'Another section is already named';

export function isNameTakenError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(NAME_TAKEN_MESSAGE);
}

export function setSectionName(
  host: DelegateHost,
  sectionId: string,
  name: string
): SetSectionNameOutcome {
  if (!host.ready) return 'failed';
  validateId(sectionId, 'section ID');
  validateName(name, 'section name');
  try {
    host.timed('setSectionName', () => host.engine.sections().setName(sectionId, name));
    host.notify('sections');
    host.notify('groups');
    return 'saved';
  } catch (e) {
    console.error('[Engine] setSectionName failed:', sectionId, e);
    return isNameTakenError(e) ? 'nameTaken' : 'failed';
  }
}

/** Delete a named corridor intent outright; its section falls back to the generated name. */
export function removeNamedCorridor(host: DelegateHost, intentId: string): boolean {
  if (!host.ready) return false;
  validateId(intentId, 'named corridor ID');
  try {
    host.timed('removeNamedCorridor', () => host.engine.sections().removeNamedCorridor(intentId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] removeNamedCorridor failed:', intentId, e);
    return false;
  }
}

/**
 * Build a new custom section from an inclusive index range of an activity's
 * stored track. The engine slices the track itself and refuses a range the
 * track cannot hold, so nothing here decodes or re-boxes points.
 */
export function createSectionFromIndices(
  host: DelegateHost,
  activityId: string,
  startIndex: number,
  endIndex: number,
  sportType: string,
  name: string | undefined
): string {
  if (!host.ready) return '';
  validateId(activityId, 'activity ID');

  const sectionId = host.timed('createSection', () =>
    host.engine.sections().create(sportType, name || undefined, activityId, startIndex, endIndex)
  );

  if (sectionId) {
    host.notify('sections');
    host.notify('groups');
  }

  return sectionId;
}

export function deleteSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('deleteSection', () => host.engine.sections().delete_(sectionId));
    host.notify('sections');
    host.notify('groups');
    return true;
  } catch (e) {
    console.error('[Engine] deleteSection failed:', sectionId, e);
    return false;
  }
}

export function setSectionReference(
  host: DelegateHost,
  sectionId: string,
  activityId: string
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  validateId(activityId, 'activity ID');
  try {
    const departed = host.timed('setSectionReference', () =>
      host.engine.sections().setReference(sectionId, activityId)
    );
    host.notify('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] setSectionReference failed:', sectionId, activityId, e);
    return null;
  }
}

export function resetSectionReference(
  host: DelegateHost,
  sectionId: string
): FfiDepartedRide[] | null {
  if (!host.ready) return null;
  validateId(sectionId, 'section ID');
  try {
    const departed = host.timed('resetSectionReference', () =>
      host.engine.sections().resetReference(sectionId)
    );
    host.notify('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] resetSectionReference failed:', sectionId, e);
    return null;
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
    console.error('[Engine] rematchActivityToSection failed:', e);
    return false;
  }
}

export function indexNewActivity(
  host: DelegateHost,
  activityId: string
): FfiIndexActivitySummary | null {
  if (!host.ready) return null;
  validateId(activityId, 'activity ID');
  try {
    const summary = host.timed('indexNewActivity', () =>
      host.engine.sections().indexNewActivity(activityId)
    );
    if (summary.insertedPortions > 0 || summary.regrouped) {
      host.notify('sections');
      host.notify('groups');
    }
    return summary;
  } catch (e) {
    // empty-on-error: a write; null is its failure and a summary says what it did.
    console.error('[Engine] indexNewActivity failed:', activityId, e);
    return null;
  }
}

export function mergeSections(
  host: DelegateHost,
  primaryId: string,
  secondaryId: string
): FfiMergeOutcome | null {
  if (!host.ready) return null;
  validateId(primaryId, 'primary section ID');
  validateId(secondaryId, 'secondary section ID');
  try {
    const result = host.timed('mergeSections', () =>
      host.engine.sections().mergeSections(primaryId, secondaryId)
    );
    host.notify('sections');
    host.notify('groups');
    return result;
  } catch (e) {
    // empty-on-error: a write; null is its failure and every outcome is a record.
    console.error('[Engine] mergeSections failed:', e);
    return null;
  }
}

/** The donor rides a merge would leave out of the section. Null when the read fails. */
export function mergePreview(
  host: DelegateHost,
  primaryId: string,
  secondaryId: string
): FfiMergeDropped[] | null {
  if (!host.ready) return null;
  validateId(primaryId, 'primary section ID');
  validateId(secondaryId, 'secondary section ID');
  try {
    return host.timed('mergePreview', () =>
      host.engine.sections().mergePreview(primaryId, secondaryId)
    );
  } catch (e) {
    // empty-on-error: an advisory list; the dialog then names nothing and the merge itself is unaffected.
    console.error('[Engine] mergePreview failed:', e);
    return null;
  }
}

// Accept-family mutations emit only `'sections'`. Group composition does not
// change on accept (only sections themselves gain `is_user_defined = 1`),
// and no current group view reads section-accept state.
// If a future group view starts depending on accept state, also emit `'groups'`.
export function acceptSection(host: DelegateHost, sectionId: string): boolean {
  if (!host.ready) return false;
  validateId(sectionId, 'section ID');
  try {
    host.timed('acceptSection', () => host.engine.sections().accept(sectionId));
    host.notify('sections');
    return true;
  } catch (e) {
    console.error('[Engine] acceptSection failed:', sectionId, e);
    return false;
  }
}

export function acceptAllSections(host: DelegateHost): number {
  if (!host.ready) return 0;
  const count = host.timed('acceptAllSections', () => host.engine.sections().acceptAll());
  host.notify('sections');
  return count;
}

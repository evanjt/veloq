/**
 * Section bounds delegates.
 *
 * Geometry editing for existing sections: trim to a narrower sub-range, reset
 * back to the original polyline, or expand to a user-supplied wider polyline.
 * The edit runs in the engine off the JS thread, re-matches activities and
 * fans out change events via `notifyAll` once it has ended, because both
 * summaries and polylines can change. It resolves with the rides the edit took
 * out of the section, or null when it failed.
 */

import { validateId } from '../../conversions';
import { FfiSectionBoundsEdit } from '../../generated/veloqrs';
import type { FfiDepartedRide } from '../../generated/veloqrs';
import type { DelegateHost } from '../host';

/** One edit to a section's bounds, the indices in the range the edit names. */
export type SectionBoundsEdit =
  | { kind: 'trim'; sectionId: string; startIndex: number; endIndex: number }
  | { kind: 'reset'; sectionId: string }
  /** `startIndex..=endIndex` of the activity's track becomes the section's line. */
  | {
      kind: 'expand';
      sectionId: string;
      activityId: string;
      startIndex: number;
      endIndex: number;
    };

function toEngineEdit(edit: SectionBoundsEdit): FfiSectionBoundsEdit {
  switch (edit.kind) {
    case 'trim':
      return FfiSectionBoundsEdit.Trim.new({
        sectionId: edit.sectionId,
        startIndex: edit.startIndex,
        endIndex: edit.endIndex,
      });
    case 'reset':
      return FfiSectionBoundsEdit.Reset.new({ sectionId: edit.sectionId });
    case 'expand':
      return FfiSectionBoundsEdit.Expand.new({
        sectionId: edit.sectionId,
        activityId: edit.activityId,
        startIndex: edit.startIndex,
        endIndex: edit.endIndex,
      });
    default:
      return edit satisfies never;
  }
}

export async function runSectionBoundsEdit(
  host: DelegateHost,
  edit: SectionBoundsEdit
): Promise<FfiDepartedRide[] | null> {
  if (!host.ready) return null;
  validateId(edit.sectionId, 'section ID');
  if (edit.kind === 'expand') validateId(edit.activityId, 'activity ID');
  try {
    const departed = await host.timedAsync('runSectionBoundsEdit', () =>
      host.engine.sections().runSectionBoundsEdit(toEngineEdit(edit))
    );
    host.notifyAll('sections');
    return departed;
  } catch (e) {
    // empty-on-error: a write; null is its failure and [] is no ride departing.
    console.error('[Engine] runSectionBoundsEdit failed:', edit, e);
    return null;
  }
}

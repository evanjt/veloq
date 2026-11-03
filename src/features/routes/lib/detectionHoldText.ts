/**
 * The words for what is holding a detect, which the engine names with the
 * routes screen read. An empty list explains itself with them, and the line
 * above a list that still shows the old catalogue says the same.
 */

import type { TFunction } from 'i18next';
import { FfiDetectionHold_Tags, type FfiDetectionHold } from 'veloqrs';

export function detectionHoldText(hold: FfiDetectionHold, t: TFunction): string {
  switch (hold.tag) {
    case FfiDetectionHold_Tags.ElevationPaused:
      return t('sections.detectionHeldElevationPaused') as string;
    case FfiDetectionHold_Tags.ElevationRunning:
      return t('sections.detectionPausedElevation') as string;
    case FfiDetectionHold_Tags.ElevationWaiting:
      return t('sections.detectionHeldElevationWaiting', { count: hold.inner.remaining }) as string;
    case FfiDetectionHold_Tags.Cutover:
      return t('sections.detectionPaused') as string;
    default: {
      const unhandled: never = hold;
      throw new Error(`Unhandled detection hold: ${String(unhandled)}`);
    }
  }
}

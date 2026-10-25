/**
 * Removing a detected section and putting it back. Removal hides the section and keeps it, so it
 * runs at once with Undo in a notice rather than behind a confirmation. Either write can be
 * refused, and a refusal is said rather than shown as done.
 */

import type { TFunction } from 'i18next';

import { getEngine } from '@/shared/native/engine';
import { inform } from '@/shared/ui/dialog';
import { showNotice } from '@/shared/ui/Notice';

/** Restore a removed section. False when the engine refused, which the athlete is told. */
export function restoreSection(sectionId: string, t: TFunction): boolean {
  if (getEngine()?.enableSection(sectionId)) return true;
  inform({ title: t('sections.restoreFailedTitle'), message: t('sections.restoreFailed') });
  return false;
}

/**
 * Remove a section and offer Undo. False when the engine is not up or refused, in which case
 * nothing changed and the caller stays where it is.
 */
export function removeSectionWithUndo(sectionId: string, t: TFunction): boolean {
  const engine = getEngine();
  if (!engine) return false;
  if (!engine.disableSection(sectionId)) {
    inform({ title: t('sections.removeFailedTitle'), message: t('sections.removeFailed') });
    return false;
  }
  showNotice({
    message: t('sections.sectionRemoved'),
    action: { label: t('common.undo'), onPress: () => restoreSection(sectionId, t) },
  });
  return true;
}

/**
 * Keep one of two sections on the same ground; the other leaves the catalogue. The notice names
 * the kept section and offers Undo, which prefers the other way round. False when the engine is
 * not up or refused, in which case nothing changed and the athlete is told.
 */
export async function preferSectionWithUndo(
  keptId: string,
  otherId: string,
  keptName: string,
  t: TFunction
): Promise<boolean> {
  const engine = getEngine();
  if (!engine) return false;
  if (!(await engine.preferSection(keptId, otherId))) {
    inform({
      title: t('sectionHistory.preferFailedTitle'),
      message: t('sectionHistory.preferFailed'),
    });
    return false;
  }
  showNotice({
    message: t('sectionHistory.preferred', { name: keptName }),
    action: {
      label: t('common.undo'),
      onPress: async () => {
        await undoPreference(otherId, keptId, t);
      },
    },
  });
  return true;
}

/** Undo for a prefer: the opposite write, said when refused, with no further Undo. */
async function undoPreference(keptId: string, otherId: string, t: TFunction): Promise<void> {
  if (await getEngine()?.preferSection(keptId, otherId)) return;
  inform({
    title: t('sectionHistory.preferFailedTitle'),
    message: t('sectionHistory.preferFailed'),
  });
}

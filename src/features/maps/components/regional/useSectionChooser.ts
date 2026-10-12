import { useCallback } from 'react';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { SectionChooserInput } from '@/app/sheets/section-chooser';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';

/**
 * Opens the section chooser sheet over the sections a tap landed on, in the
 * order given, and hands the section chosen there to `onChosen`. A dismissed
 * sheet chooses nothing, and so does one still open when the map unmounts.
 */
export function useSectionChooser(
  sections: readonly MapSection[],
  onChosen: (id: string) => void
): (ids: readonly string[]) => void {
  const openSheet = useSheetOpener();
  return useCallback(
    (ids: readonly string[]) => {
      const byId = new Map(sections.map((section) => [section.id, section]));
      const choices = ids.flatMap((id) => {
        const section = byId.get(id);
        return section
          ? [{ id: section.id, name: section.name, distanceMeters: section.distanceMeters }]
          : [];
      });
      if (choices.length === 0) return;
      void openSheet<SectionChooserInput, string>('sheets/section-chooser', {
        sections: choices,
      }).then((result) => {
        if (result.kind === 'selected') onChosen(result.value);
      });
    },
    [sections, openSheet, onChosen]
  );
}

import { useCallback } from 'react';

import type { SectionChooserInput } from '@/app/sheets/section-chooser';
import { pushHostCard, useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { detailHref } from '@/shared/app/MapSheetCards';
import { navigateTo } from '@/shared/app/navigation';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { MapPressEvent } from '../components/MapSurface';
import { contextSubjectsAtTap, type ContextSubject } from '../lib/contextPress';

/**
 * Opens the library section or route a tap landed on in a detail map's context layers: a card
 * pushed on the host the map holds, so back returns to the subject at its own camera, or the
 * detail screen when no host is open. Sections that overlap open the section chooser first.
 *
 * The handler returns whether the tap named a context subject, so a caller runs its own
 * handling for any other tap. The subject's own layers are hit-tested first and so win a tie.
 */
export function useContextPress(hostKey: string): (event: MapPressEvent) => boolean {
  const openSheet = useSheetOpener();
  return useCallback(
    (event: MapPressEvent) => {
      const subjects = contextSubjectsAtTap(
        event.features?.length ? event.features : event.feature ? [event.feature] : []
      );
      const first = subjects[0];
      if (!first) return false;

      const open = ({ kind, id }: Pick<ContextSubject, 'kind' | 'id'>) => {
        if (useMapSheetHosts.getState().hosts[hostKey]) pushHostCard(hostKey, { kind, id });
        else navigateTo(detailHref({ kind, id }));
      };
      // The surface returns the hits of one layer, so the list is all sections or all routes.
      if (first.kind === 'section' && subjects.length > 1) {
        const sections = subjects.map(({ id, name, distanceMeters }) => ({
          id,
          name,
          distanceMeters,
        }));
        void openSheet<SectionChooserInput, string>('sheets/section-chooser', { sections }).then(
          (result) => {
            if (result.kind === 'selected') open({ kind: 'section', id: result.value });
          }
        );
      } else {
        open(first);
      }
      return true;
    },
    [hostKey, openSheet]
  );
}

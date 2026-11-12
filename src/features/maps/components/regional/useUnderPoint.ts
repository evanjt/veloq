import { useCallback, useRef, useState } from 'react';
import { maps } from 'veloqrs';
import type { FfiUnderPointGroup } from 'veloqrs';

import { navigateTo } from '@/shared/app/navigation';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { UnderPointInput } from '@/app/sheets/under-point';
import { underPointKey, underPointZoom } from '@/features/maps/lib/underPoint';
import { nativeGeoUrl } from '@/features/maps/lib/tileTransport';

export interface UnderPoint {
  /** Lists the activities under a tap on the heatmap and opens the sheet that offers them. */
  lookUp: (latitude: number, longitude: number, zoom: number) => void;
  /**
   * The engine's URL for the traces of the group chosen in the sheet, or null
   * when none is drawn. The map keeps its source mounted either way.
   */
  traceUrl: string | null;
}

/**
 * The heatmap tap's answer. The engine lists the activities under the tap and a
 * sheet offers them by route; the group chosen there is drawn on the map from
 * the engine's URL until the sheet is dismissed, and a chosen activity opens
 * its detail.
 *
 * A tap before the last one has answered supersedes it, so the sheet opens for
 * the newest tap only.
 */
export function useUnderPoint(): UnderPoint {
  const openSheet = useSheetOpener();
  const [traceUrl, setTraceUrl] = useState<string | null>(null);
  const generation = useRef(0);

  const lookUp = useCallback(
    (latitude: number, longitude: number, tapZoom: number) => {
      generation.current += 1;
      const mine = generation.current;
      const zoom = underPointZoom(tapZoom);

      const draw = (group: FfiUnderPointGroup | null) => {
        if (generation.current !== mine) return;
        setTraceUrl(
          group
            ? nativeGeoUrl(
                'under-point',
                underPointKey(latitude, longitude, zoom, group.routeId ?? null),
                mine
              )
            : null
        );
      };

      const answerAndOpen = async () => {
        const answer = await maps.getActivitiesUnderPoint(latitude, longitude, zoom);
        if (generation.current !== mine || answer.total === 0 || answer.groups.length === 0) return;
        const result = await openSheet<UnderPointInput, string>('sheets/under-point', {
          total: answer.total,
          traceCap: answer.traceCap,
          groups: answer.groups,
          onGroup: draw,
        });
        draw(null);
        if (result.kind === 'selected') navigateTo(`/activity/${result.value}`);
      };
      answerAndOpen().catch(() => {
        // A tap whose lookup failed is a tap on bare ground: nothing is drawn and nothing opens.
      });
    },
    [openSheet]
  );

  return { lookUp, traceUrl };
}

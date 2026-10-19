/**
 * A detail host's one map: the map of whichever card is on top of its sheet, by the card's kind,
 * drawn on one surface that stays mounted while the cards change.
 *
 * A change of top card swaps what the surface draws and moves its camera to the new subject,
 * fitted to the map the header and the sheet leave visible. Each card keeps the camera its map
 * was last left at in its own state, so popping back to a card shows it where the athlete left it.
 * The overlays each kind's map draws over the surface (its key, its controls, its 3D view, a
 * tool's bar) come and go with its card.
 */
import React, { useCallback } from 'react';

import { MapSurfaceSlot, type MapCameraSpec, type MapCameraState } from '@/features/maps';
import { useMapSheetHost } from '@/shared/app/MapSheetHost';
import {
  patchHostTopCard,
  topCard,
  useHostTopCardSubject,
  useMapSheetHosts,
  type MapSheetCardKind,
  type MapSheetCardParams,
} from '@/shared/app/mapSheetHost';
import { RouteDetailMap } from './RouteDetailMap';
import { SectionDetailMap } from './SectionDetailMap';

/** The card state field holding the camera the card's map was last left at. */
const MAP_CAMERA = 'mapCamera';

/**
 * What a card was opened with: the host's route for its root card, the push for any other.
 * `activityId` is the activity the page was opened from, the only one the map key calls "This
 * activity", and `previewVersion` a stored version of a section that History asked to show.
 */
export type DetailMapHostParams = MapSheetCardParams;

/** The key a subject is shown under: a card at another depth is another showing. */
export function detailMapSubjectKey(subject: {
  kind: MapSheetCardKind;
  id: string;
  depth: number;
}): string {
  return `${subject.depth}:${subject.kind}:${subject.id}`;
}

export function DetailMapHost({ rootParams }: { rootParams: DetailMapHostParams }) {
  const key = useMapSheetHost()?.key ?? '';
  const subject = useHostTopCardSubject(key);

  const cameraOf = useCallback(
    () =>
      topCard(useMapSheetHosts.getState().hosts, key)?.state[MAP_CAMERA] as
        MapCameraSpec | undefined,
    [key]
  );
  const onCameraSettled = useCallback(
    ({ center, zoom, bearing, pitch }: MapCameraState) =>
      patchHostTopCard(key, { [MAP_CAMERA]: { center, zoom, bearing, pitch } }),
    [key]
  );

  const subjectKey = subject ? detailMapSubjectKey(subject) : '';
  return (
    <MapSurfaceSlot subject={subjectKey} cameraOf={cameraOf} onCameraSettled={onCameraSettled}>
      {subject ? (
        <SubjectMap
          key={subjectKey}
          kind={subject.kind}
          id={subject.id}
          params={subject.depth === 1 ? rootParams : subject.params}
        />
      ) : null}
    </MapSurfaceSlot>
  );
}

function SubjectMap({
  kind,
  id,
  params,
}: {
  kind: MapSheetCardKind;
  id: string;
  params: DetailMapHostParams;
}) {
  switch (kind) {
    case 'route':
      return <RouteDetailMap routeId={id} pageActivityId={params.activityId} />;
    case 'section':
    case 'section-history':
    case 'section-laps':
      return (
        <SectionDetailMap
          sectionId={id}
          pageActivityId={params.activityId}
          previewVersion={params.previewVersion}
        />
      );
    case 'activity': {
      // Loaded when first drawn, since the activity feature reads this one's barrel.
      const { ActivityDetailMap } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@/features/activity/components/ActivityDetailMap') as typeof import('@/features/activity/components/ActivityDetailMap');
      return <ActivityDetailMap activityId={id} />;
    }
  }
}

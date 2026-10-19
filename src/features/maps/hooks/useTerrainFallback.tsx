import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TerrainUnavailableNotice,
  type TerrainNoticePlacement,
} from '../components/TerrainUnavailableNotice';
import { BottomPillSlot } from '@/shared/ui/BottomPillStack';
import { layers } from '@/theme';

/**
 * The one rule every 3D host follows when the page drew without DEM tiles: the
 * "3D" view is then the flat map with a wasted WebView on top, so the host
 * leaves 3D and says why rather than leaving it looking like broken 3D.
 *
 * `leave3D` is the host's own way out of 3D mode, the same landing as a page
 * that failed outright. The returned handler goes to the terrain map's
 * `onTerrainUnavailable`, `Map3DWebView`'s or `MapSurface`'s, and
 * `terrainNotice` is rendered over the map. An
 * embedded map keeps it at its own foot, beside what it explains. A map that
 * fills a tab puts it in the bottom pill stack, above whatever covers the foot
 * of the screen and the pills below it.
 */
export function useTerrainFallback(
  leave3D: () => void,
  placement: TerrainNoticePlacement = 'mapFoot'
) {
  const [shown, setShown] = useState(false);

  // Hosts pass a fresh arrow each render; the handler handed to the WebView stays stable.
  const leave3DRef = useRef(leave3D);
  useEffect(() => {
    leave3DRef.current = leave3D;
  });

  const onTerrainUnavailable = useCallback(() => {
    leave3DRef.current();
    setShown(true);
  }, []);

  const dismiss = useCallback(() => setShown(false), []);

  const notice = shown ? (
    <TerrainUnavailableNotice onDismiss={dismiss} placement={placement} />
  ) : null;
  const terrainNotice =
    notice && placement === 'pillStack' ? (
      <BottomPillSlot pill="terrain" layer={layers.mapOverlay}>
        {notice}
      </BottomPillSlot>
    ) : (
      notice
    );

  return { onTerrainUnavailable, terrainNotice };
}

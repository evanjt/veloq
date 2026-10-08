import { useCallback, useEffect, useRef, useState } from 'react';

import { TerrainUnavailableNotice } from '../components/TerrainUnavailableNotice';

/**
 * The one rule every 3D host follows when the page drew without DEM tiles: the
 * "3D" view is then the flat map with a wasted WebView on top, so the host
 * leaves 3D and says why rather than leaving it looking like broken 3D.
 *
 * `leave3D` is the host's own way out of 3D mode, the same landing as a page
 * that failed outright. The returned handler goes to `Map3DWebView`'s
 * `onTerrainUnavailable`, and `terrainNotice` is rendered over the map, lifted
 * by `noticeBottom` when the host covers the foot of its map.
 */
export function useTerrainFallback(leave3D: () => void, noticeBottom?: number) {
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

  const terrainNotice = shown ? (
    <TerrainUnavailableNotice onDismiss={dismiss} bottom={noticeBottom} />
  ) : null;

  return { onTerrainUnavailable, terrainNotice };
}

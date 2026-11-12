import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useMapSheetHost } from '@/shared/app/MapSheetHost';
import { hostTerrain3D, setHostTerrain3D, useHostTerrain3D } from '@/shared/app/mapSheetHost';

type Terrain3DUpdate = boolean | ((current: boolean) => boolean);

/**
 * Whether a map is tilted over terrain, and how to change it. Inside a detail host the mode is
 * the host's, one for every card, so a card pushed or popped opens in the mode its neighbour was
 * left in. The first map in a host publishes its own opening mode. Outside a host the mode is the
 * view's own state. `inherited` is true when the host already held a mode at mount, which is a
 * choice made on another card and not this view's to override.
 */
export function useSharedTerrain3D(initial: boolean): {
  is3D: boolean;
  setIs3D: (update: Terrain3DUpdate) => void;
  inherited: boolean;
} {
  const key = useMapSheetHost()?.key;
  const [local, setLocal] = useState(initial);
  const held = useHostTerrain3D(key);
  const is3D = held ?? local;
  const [inherited] = useState(key !== undefined && held !== undefined);

  const currentRef = useRef(is3D);
  useLayoutEffect(() => {
    currentRef.current = is3D;
  }, [is3D]);

  useEffect(() => {
    if (key && hostTerrain3D(key) === undefined) setHostTerrain3D(key, local);
  }, [key, local]);

  const setIs3D = useCallback(
    (update: Terrain3DUpdate) => {
      const next = typeof update === 'function' ? update(currentRef.current) : update;
      currentRef.current = next;
      setLocal(next);
      if (key) setHostTerrain3D(key, next);
    },
    [key]
  );
  return { is3D, setIs3D, inherited };
}

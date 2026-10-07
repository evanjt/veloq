import { AppState } from 'react-native';

import { registerReclaimer, TRIM_MODERATE } from '@/shared/app/memoryPressure';

import { releaseMountedSurfaces, rebuildReleasedSurfaces } from './mapSurfaceRegistry';

/**
 * The MapLibre instances themselves, with every texture in them. A map the
 * athlete is looking at is never torn down, which is what iOS's foreground
 * warning would otherwise do. The rebuild is a page reload on the next
 * foreground, the same path a crashed render process takes.
 */
export function registerMapSurfaceReclaimer(): () => void {
  const off = registerReclaimer({
    name: 'map-surfaces',
    minLevel: TRIM_MODERATE,
    release: () => {
      if (AppState.currentState === 'active') return;
      releaseMountedSurfaces();
    },
  });
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') rebuildReleasedSurfaces();
  });
  return () => {
    off();
    foreground.remove();
  };
}

/**
 * Lifecycle hook for ambient tile caching.
 * Initializes MapLibre's ambient cache on mount so tiles viewed by the user
 * are cached locally for offline use.
 *
 * Mount in tab layout so it runs while the app is active.
 */

import { useEffect } from 'react';
import * as TileCacheService from '@/lib/maps/tileCacheService';

export function useTilePrefetch(): void {
  useEffect(() => {
    TileCacheService.initializeAmbientCache();
  }, []);
}

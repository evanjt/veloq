import { useMemo } from 'react';
import { useTheme } from '@/shared/app';
import { useIsOnline } from '@/shared/app/NetworkContext';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { offlineMapStyle } from '@/features/maps/lib/offlineStyleFallback';

/**
 * The style a map surface draws for the style the athlete chose. Satellite
 * imagery is never kept on the device, so offline it is the theme's vector
 * basemap; the chosen style is not written back.
 */
export function useDrawnMapStyle(chosen: MapStyleType): MapStyleType {
  const { isDark } = useTheme();
  const isOnline = useIsOnline();
  return useMemo(
    () => offlineMapStyle(chosen, isOnline, isDark ? 'dark' : 'light'),
    [chosen, isOnline, isDark]
  );
}

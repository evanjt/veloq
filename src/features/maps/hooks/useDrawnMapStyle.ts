import { useCallback, useMemo } from 'react';
import { useTheme } from '@/shared/app';
import { useIsOnline } from '@/shared/app/NetworkContext';
import { getNextStyle, type MapStyleType } from '@/features/maps/components/mapStyles';
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

/**
 * The drawn style and the style toggle every map carries. The toggle steps on
 * from the style drawn, which is the one its icon names, so a tap always
 * changes the basemap on screen: offline with satellite chosen, stepping from
 * the choice would choose the theme's basemap that is already drawn. Where
 * the choice is kept, and for how long, stays with the caller.
 */
export function useMapStyleToggle(
  chosen: MapStyleType,
  choose: (next: MapStyleType) => void
): { drawn: MapStyleType; cycle: () => void } {
  const drawn = useDrawnMapStyle(chosen);
  const cycle = useCallback(() => choose(getNextStyle(drawn)), [choose, drawn]);
  return { drawn, cycle };
}

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
 * from the style drawn, so a tap always changes the basemap on screen, and it
 * skips satellite while satellite cannot be drawn. `next` is the style a tap
 * draws, so a toggle's glyph takes it through `getStyleIcon`. Where the choice
 * is kept, and for how long, stays with the caller.
 */
export function useMapStyleToggle(
  chosen: MapStyleType,
  choose: (next: MapStyleType) => void
): { drawn: MapStyleType; next: MapStyleType; cycle: () => void } {
  const drawn = useDrawnMapStyle(chosen);
  const isOnline = useIsOnline();
  const next = useMemo(() => getNextStyle(drawn, { satellite: isOnline }), [drawn, isOnline]);
  const cycle = useCallback(() => choose(next), [choose, next]);
  return { drawn, next, cycle };
}

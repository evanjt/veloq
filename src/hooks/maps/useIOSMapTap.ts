/**
 * useIOSMapTap — iOS-specific tap handling for MapLibre.
 *
 * MapView.onPress does not fire reliably on iOS with the Fabric renderer, so
 * we attach `onTouchStart` / `onTouchEnd` to the map container and detect tap
 * gestures manually. The tap handler converts screen coordinates to
 * map coordinates via `mapRef.getCoordinateFromView()` and calls through to
 * `onMapPress` with a synthesised `Point` feature.
 *
 * Extracted from ActivityMapView.tsx — pure refactor, no behaviour change.
 */

import { useCallback, useRef } from 'react';
import type { MapRef } from '@maplibre/maplibre-react-native';

/** Maximum tap duration in ms before treated as a drag/hold. */
const TAP_MAX_DURATION_MS = 300;
/** Maximum movement in pixels before treated as a drag. */
const TAP_MAX_MOVE_PX = 10;

interface UseIOSMapTapParams {
  /** Ref to the MapLibre Map, used to convert screen → map coordinates. */
  mapRef: React.RefObject<MapRef | null>;
  /** Called with a synthesised Point feature when the user taps the map. */
  onMapPress: (feature: GeoJSON.Feature) => void;
}

interface TouchEvent {
  nativeEvent: { locationX: number; locationY: number };
}

interface UseIOSMapTapResult {
  /** Attach to the map container's `onTouchStart`. */
  onTouchStart: (e: TouchEvent) => void;
  /**
   * Attach to the map container's `onTouchEnd`. Fires `onMapPress` if the
   * touch qualifies as a tap and the `shouldHandleTap` check (if any) passes.
   */
  onTouchEnd: (e: TouchEvent, shouldHandleTap?: () => boolean) => void;
}

export function useIOSMapTap({ mapRef, onMapPress }: UseIOSMapTapParams): UseIOSMapTapResult {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTap = useCallback(
    async (screenX: number, screenY: number) => {
      if (!mapRef.current) return;

      try {
        const coords = await mapRef.current.unproject([screenX, screenY]);
        if (!coords || coords.length < 2) return;

        const feature: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: coords,
          },
        };

        onMapPress(feature);
      } catch {
        // Silently fail — tap handling is best effort
      }
    },
    [mapRef, onMapPress]
  );

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
      time: Date.now(),
    };
  }, []);

  const onTouchEnd = useCallback(
    (e: TouchEvent, shouldHandleTap?: () => boolean) => {
      const start = touchStartRef.current;
      if (!start) return;

      const dx = Math.abs(e.nativeEvent.locationX - start.x);
      const dy = Math.abs(e.nativeEvent.locationY - start.y);
      const duration = Date.now() - start.time;
      const isTap = duration < TAP_MAX_DURATION_MS && dx < TAP_MAX_MOVE_PX && dy < TAP_MAX_MOVE_PX;

      if (isTap && (!shouldHandleTap || shouldHandleTap())) {
        handleTap(e.nativeEvent.locationX, e.nativeEvent.locationY);
      }

      touchStartRef.current = null;
    },
    [handleTap]
  );

  return { onTouchStart, onTouchEnd };
}

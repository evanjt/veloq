import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AttributionOverlayRef } from '@/features/maps/components/AttributionOverlay';
import type { MapCameraState } from '@/features/maps/components/MapSurface';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { LngLat, LngLatBounds } from '@/features/maps/lib/coordinates';

/** The zoom a satellite credit is read at before the camera first settles. */
const UNSETTLED_ZOOM = 11;

interface Viewport {
  center: LngLat;
  zoom: number;
  bounds: LngLatBounds;
}

export interface SurfaceAttributionOptions {
  /** Terrain is drawn, so its source is credited too. */
  is3D?: boolean | undefined;
  /** Where the map opens, which places a satellite credit before the camera settles. */
  center?: LngLat | null | undefined;
}

export interface SurfaceAttribution {
  /** Goes on the surface's `AttributionOverlay`. */
  attributionRef: React.RefObject<AttributionOverlayRef | null>;
  /** The overlay's text for its first paint. */
  initialAttribution: string;
  /** Called with every camera the surface settles at. */
  trackAttribution: (state: MapCameraState) => void;
}

/**
 * The credit line for a `MapSurface`, which draws none of its own. Attribution
 * is a licence condition, so it names the base actually drawn: the style's
 * source, and over satellite imagery the regional sources across the settled
 * viewport. A camera move updates the overlay through its ref, so it never
 * re-renders the surface's owner.
 */
export function useSurfaceAttribution(
  style: MapStyleType,
  { is3D = false, center = null }: SurfaceAttributionOptions = {}
): SurfaceAttribution {
  const attributionRef = useRef<AttributionOverlayRef>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const lng = center?.[0] ?? null;
  const lat = center?.[1] ?? null;

  const textFor = useCallback(
    (viewport: Viewport | null) =>
      computeAttribution({
        style,
        is3D,
        center: viewport?.center ?? (lng !== null && lat !== null ? [lng, lat] : null),
        zoom: viewport?.zoom ?? UNSETTLED_ZOOM,
        bounds: viewport?.bounds ?? null,
      }),
    [style, is3D, lng, lat]
  );

  // Only the overlay's mount reads this; later text goes through the ref.
  const initialAttribution = useMemo(() => textFor(null), [textFor]);

  const textForRef = useRef(textFor);
  useEffect(() => {
    textForRef.current = textFor;
    attributionRef.current?.setAttribution(textFor(viewportRef.current));
  }, [textFor]);

  const trackAttribution = useCallback((state: MapCameraState) => {
    viewportRef.current = { center: state.center, zoom: state.zoom, bounds: state.bounds };
    attributionRef.current?.setAttribution(textForRef.current(viewportRef.current));
  }, []);

  return { attributionRef, initialAttribution, trackAttribution };
}

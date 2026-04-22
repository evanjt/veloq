/**
 * Map layer GeoJSON preparation for ActivityMapView.
 *
 * Builds all GeoJSON data structures needed by MapLibre shape sources:
 * route line, route overlay, section overlays (consolidated), highlight point,
 * and section marker elements.
 *
 * Extracted from ActivityMapView.tsx — pure refactor, no behaviour change.
 */

import { useMemo } from 'react';
import type { LatLng } from '@/lib';
import type { SectionOverlay } from '@/components/maps/ActivityMapView';
import { sectionPaletteIndex } from '@/theme';
import { buildGradientLineStops } from '@/lib/maps/gradientLineColor';
import type { ActivityStreams } from '@/types';

/** Data about a single section overlay used by the rendering layer */
export interface SectionOverlayGeoJSON {
  id: string;
  sectionGeo: GeoJSON.Feature | null;
  portionGeo: GeoJSON.Feature | null;
  isPR?: boolean;
}

interface UseMapLayersParams {
  /** Decoded and validated coordinates for the activity track */
  validCoordinates: LatLng[];
  /** All decoded coordinates (including invalid — used for highlight index lookup) */
  coordinates: LatLng[];
  /** Route overlay coordinates (e.g., matched route trace) */
  routeOverlay?: LatLng[] | null;
  /** Section overlays for the sections tab */
  sectionOverlays?: SectionOverlay[] | null;
  /** Index into coordinates to highlight (from chart scrubbing) */
  highlightIndex?: number | null;
  /** Active tab — controls marker style (numbered on sections, PR on charts) */
  activeTab?: string;
  /** Activity streams — used to build per-point gradient colors */
  streams?: ActivityStreams | null;
}

interface UseMapLayersResult {
  /** GeoJSON for the activity route line */
  routeGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  /** Whether routeGeoJSON contains renderable data */
  routeHasData: boolean;
  /** GeoJSON for the route overlay (matched route trace) */
  overlayGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  /** Whether overlayGeoJSON contains renderable data */
  overlayHasData: boolean;
  /** Per-overlay data for marker positioning */
  sectionOverlaysGeoJSON: SectionOverlayGeoJSON[] | null;
  /** Consolidated section polylines GeoJSON (stable shape source) */
  consolidatedSectionsGeoJSON: GeoJSON.FeatureCollection;
  /** Consolidated portion polylines GeoJSON (stable shape source) */
  consolidatedPortionsGeoJSON: GeoJSON.FeatureCollection;
  /** Perpendicular tick marks at each section's start/end. Cuts through stacked
   *  portion overlays so section boundaries are visible even when portions overlap. */
  sectionBoundariesGeoJSON: GeoJSON.FeatureCollection;
  /** GeoJSON for geo-anchored section markers (ShapeSource + CircleLayer + SymbolLayer) */
  sectionMarkersGeoJSON: GeoJSON.FeatureCollection;
  /** GeoJSON for PR-only section markers in fullscreen modal */
  fullscreenPRMarkersGeoJSON: GeoJSON.FeatureCollection;
  /** Route coordinates in [lng, lat] format for BaseMapView / Map3DWebView */
  routeCoords: [number, number][];
  /** The highlighted point from chart selection, or null */
  highlightPoint: LatLng | null;
  /** GeoJSON for highlight point (ShapeSource + CircleLayer) */
  highlightGeoJSON: GeoJSON.Feature<GeoJSON.Point>;
  /**
   * MapLibre `line-gradient` interpolation expression for the route line,
   * derived from altitude + distance streams. `null` when gradient data is
   * unavailable (no altitude/distance stream, or track too short).
   */
  gradientLineExpression: unknown | null;
}

/** Minimal valid geometry placeholder — prevents Fabric add/remove crashes */
const MINIMAL_LINE: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { _placeholder: true },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 0.0001],
        ],
      },
    },
  ],
};

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection' as const,
  features: [],
};

export function useMapLayers({
  validCoordinates,
  coordinates,
  routeOverlay,
  sectionOverlays,
  highlightIndex,
  activeTab,
  streams,
}: UseMapLayersParams): UseMapLayersResult {
  // ----- route line -----
  const routeGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (validCoordinates.length < 2) {
      if (__DEV__) {
        console.warn(
          `[ActivityMapView] routeGeoJSON: insufficient coordinates (${validCoordinates.length})`
        );
      }
      return EMPTY_COLLECTION;
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validCoordinates.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [validCoordinates]);

  const routeHasData =
    routeGeoJSON.type === 'Feature' ||
    (routeGeoJSON.type === 'FeatureCollection' && routeGeoJSON.features.length > 0);

  // ----- route overlay (matched route trace) -----
  const overlayGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!routeOverlay || routeOverlay.length < 2) {
      return EMPTY_COLLECTION;
    }
    const validOverlay = routeOverlay.filter((c) => !isNaN(c.latitude) && !isNaN(c.longitude));
    if (validOverlay.length < 2) {
      return EMPTY_COLLECTION;
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: validOverlay.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [routeOverlay]);

  const overlayHasData =
    overlayGeoJSON.type === 'Feature' ||
    (overlayGeoJSON.type === 'FeatureCollection' && overlayGeoJSON.features.length > 0);

  // ----- section overlays GeoJSON -----
  const { sectionOverlaysGeoJSON, consolidatedSectionsGeoJSON, consolidatedPortionsGeoJSON } =
    useMemo(() => {
      if (!sectionOverlays || sectionOverlays.length === 0) {
        return {
          sectionOverlaysGeoJSON: null as SectionOverlayGeoJSON[] | null,
          consolidatedSectionsGeoJSON: MINIMAL_LINE,
          consolidatedPortionsGeoJSON: MINIMAL_LINE,
        };
      }

      let skippedSections = 0;
      let skippedPortions = 0;
      const sectionFeatures: GeoJSON.Feature[] = [];
      const portionFeatures: GeoJSON.Feature[] = [];
      const overlayData: SectionOverlayGeoJSON[] = [];

      sectionOverlays.forEach((overlay) => {
        const validSectionPoints = overlay.sectionPolyline.filter(
          (c) =>
            Number.isFinite(c.latitude) &&
            Number.isFinite(c.longitude) &&
            !isNaN(c.latitude) &&
            !isNaN(c.longitude)
        );

        let sectionGeo: GeoJSON.Feature | null = null;
        if (validSectionPoints.length >= 2) {
          sectionGeo = {
            type: 'Feature',
            properties: {
              id: overlay.id,
              type: 'section',
              isPR: !!overlay.isPR,
              colorIndex: sectionPaletteIndex(overlay.id),
            },
            geometry: {
              type: 'LineString',
              coordinates: validSectionPoints.map((c) => [c.longitude, c.latitude]),
            },
          };
          sectionFeatures.push(sectionGeo);
        } else if (overlay.sectionPolyline.length > 0) {
          skippedSections++;
          if (__DEV__) {
            console.warn(
              `[ActivityMapView] INVALID SECTION OVERLAY: id=${overlay.id} originalPoints=${overlay.sectionPolyline.length} validPoints=${validSectionPoints.length}`
            );
          }
        }

        const validPortionPoints = overlay.activityPortion?.filter(
          (c) =>
            Number.isFinite(c.latitude) &&
            Number.isFinite(c.longitude) &&
            !isNaN(c.latitude) &&
            !isNaN(c.longitude)
        );

        let portionGeo: GeoJSON.Feature | null = null;
        if (validPortionPoints && validPortionPoints.length >= 2) {
          portionGeo = {
            type: 'Feature',
            properties: {
              id: overlay.id,
              type: 'portion',
              isPR: !!overlay.isPR,
              colorIndex: sectionPaletteIndex(overlay.id),
            },
            geometry: {
              type: 'LineString',
              coordinates: validPortionPoints.map((c) => [c.longitude, c.latitude]),
            },
          };
          portionFeatures.push(portionGeo);
        } else if (overlay.activityPortion && overlay.activityPortion.length > 0) {
          skippedPortions++;
          if (__DEV__) {
            console.warn(
              `[ActivityMapView] INVALID PORTION OVERLAY: id=${overlay.id} originalPoints=${overlay.activityPortion.length} validPoints=${validPortionPoints?.length ?? 0}`
            );
          }
        }

        overlayData.push({ id: overlay.id, sectionGeo, portionGeo, isPR: overlay.isPR });
      });

      if (__DEV__ && (skippedSections > 0 || skippedPortions > 0)) {
        console.warn(
          `[ActivityMapView] sectionOverlaysGeoJSON: skipped ${skippedSections} sections, ${skippedPortions} portions with invalid polylines`
        );
      }

      return {
        sectionOverlaysGeoJSON: overlayData.length > 0 ? overlayData : null,
        consolidatedSectionsGeoJSON:
          sectionFeatures.length > 0
            ? ({
                type: 'FeatureCollection' as const,
                features: sectionFeatures,
              } as GeoJSON.FeatureCollection)
            : MINIMAL_LINE,
        consolidatedPortionsGeoJSON:
          portionFeatures.length > 0
            ? ({
                type: 'FeatureCollection' as const,
                features: portionFeatures,
              } as GeoJSON.FeatureCollection)
            : MINIMAL_LINE,
      };
    }, [sectionOverlays]);

  // ----- section marker GeoJSON -----
  // Sections tab: numbered markers (1, 2, 3...) for all sections
  // Charts tab: PR markers for PR sections only
  // Uses GeoJSON + ShapeSource/CircleLayer/SymbolLayer so markers geo-anchor and track with pan/zoom.
  // MarkerView was previously used but its coordinate updates break native position binding.
  const sectionMarkersGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!sectionOverlaysGeoJSON) return EMPTY_COLLECTION;

    const isPRMarker = activeTab !== 'sections';
    const overlaysToRender = isPRMarker
      ? sectionOverlaysGeoJSON.filter((o) => o.isPR)
      : sectionOverlaysGeoJSON;
    if (overlaysToRender.length === 0) return EMPTY_COLLECTION;

    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    overlaysToRender.forEach((overlay, index) => {
      const sectionGeom = overlay.sectionGeo?.geometry as GeoJSON.LineString | undefined;
      const portionGeom = overlay.portionGeo?.geometry as GeoJSON.LineString | undefined;
      const coords = portionGeom?.coordinates || sectionGeom?.coordinates;
      if (!coords || coords.length < 2) return;

      const midIndex = Math.floor(coords.length / 2);
      const midCoord = coords[midIndex];
      if (
        !midCoord ||
        typeof midCoord[0] !== 'number' ||
        typeof midCoord[1] !== 'number' ||
        !Number.isFinite(midCoord[0]) ||
        !Number.isFinite(midCoord[1])
      ) {
        return;
      }

      const prevIndex = Math.max(0, midIndex - 1);
      const nextIndex = Math.min(coords.length - 1, midIndex + 1);
      const prevCoord = coords[prevIndex];
      const nextCoord = coords[nextIndex];

      const dx = nextCoord[0] - prevCoord[0];
      const dy = nextCoord[1] - prevCoord[1];
      const len = Math.sqrt(dx * dx + dy * dy);

      const offsetDistance = 0.00035; // ~35 meters at equator
      const offsetLng = len > 0 ? (-dy / len) * offsetDistance : 0;
      const offsetLat = len > 0 ? (dx / len) * offsetDistance : 0;

      const markerLng = midCoord[0] + offsetLng;
      const markerLat = midCoord[1] + offsetLat;
      if (!Number.isFinite(markerLng) || !Number.isFinite(markerLat)) return;

      features.push({
        type: 'Feature',
        properties: {
          sectionId: overlay.id,
          label: isPRMarker ? 'PR' : String(index + 1),
          isPR: isPRMarker,
        },
        geometry: { type: 'Point', coordinates: [markerLng, markerLat] },
      });
    });

    return { type: 'FeatureCollection', features };
  }, [sectionOverlaysGeoJSON, activeTab]);

  // ----- section boundary ticks -----
  // Perpendicular short line segments at each section's start and end.
  // These cut through the stacked portion overlays so the user can see exactly
  // where each section begins and ends, even where multiple sections overlap.
  const sectionBoundariesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!sectionOverlaysGeoJSON) return EMPTY_COLLECTION;

    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const halfLen = 0.00014; // ~15m perpendicular tick at mid latitudes

    sectionOverlaysGeoJSON.forEach((overlay) => {
      const portionGeom = overlay.portionGeo?.geometry as GeoJSON.LineString | undefined;
      const coords = portionGeom?.coordinates;
      if (!coords || coords.length < 2) return;

      const buildTick = (midIdx: number, neighborIdx: number, kind: 'start' | 'end') => {
        const mid = coords[midIdx];
        const neighbor = coords[neighborIdx];
        if (!mid || !neighbor) return;
        const dx = neighbor[0] - mid[0];
        const dy = neighbor[1] - mid[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return;
        const nx = -dy / len;
        const ny = dx / len;
        const a: [number, number] = [mid[0] + nx * halfLen, mid[1] + ny * halfLen];
        const b: [number, number] = [mid[0] - nx * halfLen, mid[1] - ny * halfLen];
        if (!Number.isFinite(a[0]) || !Number.isFinite(b[0])) return;
        features.push({
          type: 'Feature',
          properties: { sectionId: overlay.id, kind, isPR: !!overlay.isPR },
          geometry: { type: 'LineString', coordinates: [a, b] },
        });
      };

      buildTick(0, 1, 'start');
      buildTick(coords.length - 1, coords.length - 2, 'end');
    });

    return { type: 'FeatureCollection', features };
  }, [sectionOverlaysGeoJSON]);

  // ----- fullscreen PR marker GeoJSON -----
  // Always PR-only; uses section geometry midpoint without perpendicular offset.
  const fullscreenPRMarkersGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!sectionOverlaysGeoJSON) return EMPTY_COLLECTION;

    const prOverlays = sectionOverlaysGeoJSON.filter((o) => o.isPR);
    if (prOverlays.length === 0) return EMPTY_COLLECTION;

    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    prOverlays.forEach((overlay) => {
      const sectionGeom = overlay.sectionGeo?.geometry as GeoJSON.LineString | undefined;
      const coords = sectionGeom?.coordinates;
      if (!coords || coords.length === 0) return;

      const midIndex = Math.floor(coords.length / 2);
      const midCoord = coords[midIndex];
      if (!midCoord || !Number.isFinite(midCoord[0]) || !Number.isFinite(midCoord[1])) {
        return;
      }

      features.push({
        type: 'Feature',
        properties: { sectionId: overlay.id, label: 'PR' },
        geometry: { type: 'Point', coordinates: [midCoord[0], midCoord[1]] },
      });
    });

    return { type: 'FeatureCollection', features };
  }, [sectionOverlaysGeoJSON]);

  // ----- route coordinates in [lng, lat] for BaseMapView / Map3DWebView -----
  const routeCoords = useMemo(() => {
    return validCoordinates.map((c) => [c.longitude, c.latitude] as [number, number]);
  }, [validCoordinates]);

  // ----- highlight point -----
  const highlightPoint = useMemo(() => {
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < coordinates.length) {
      const coord = coordinates[highlightIndex];
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  // ----- highlight GeoJSON -----
  const highlightGeoJSON = useMemo(
    (): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: highlightPoint ? [highlightPoint.longitude, highlightPoint.latitude] : [0, 0],
      },
    }),
    [highlightPoint]
  );

  // ----- gradient line expression (for "color by gradient" mode) -----
  // Uses intervals.icu's `grade_smooth` stream. Resampled to at most ~100
  // stops so the expression stays compact regardless of track length.
  const gradientLineExpression = useMemo(() => {
    if (!streams || validCoordinates.length < 2) return null;
    const stops = buildGradientLineStops(streams.grade_smooth);
    if (!stops) return null;
    return ['interpolate', ['linear'], ['line-progress'], ...stops];
  }, [streams, validCoordinates.length]);

  return {
    routeGeoJSON,
    routeHasData,
    overlayGeoJSON,
    overlayHasData,
    sectionOverlaysGeoJSON,
    consolidatedSectionsGeoJSON,
    consolidatedPortionsGeoJSON,
    sectionBoundariesGeoJSON,
    sectionMarkersGeoJSON,
    fullscreenPRMarkersGeoJSON,
    routeCoords,
    highlightPoint,
    highlightGeoJSON,
    gradientLineExpression,
  };
}

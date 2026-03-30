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
            properties: { id: overlay.id, type: 'section', isPR: !!overlay.isPR },
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
            properties: { id: overlay.id, type: 'portion' },
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

  return {
    routeGeoJSON,
    routeHasData,
    overlayGeoJSON,
    overlayHasData,
    sectionOverlaysGeoJSON,
    consolidatedSectionsGeoJSON,
    consolidatedPortionsGeoJSON,
    sectionMarkersGeoJSON,
    fullscreenPRMarkersGeoJSON,
    routeCoords,
    highlightPoint,
    highlightGeoJSON,
  };
}

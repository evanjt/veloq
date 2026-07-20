import { useMemo } from 'react';
import { type Expression } from '@maplibre/maplibre-react-native';
import { decodeCoords } from 'veloqrs';

import type { FrequentSection, RoutePoint } from '@/types';

// Module-level stable reference - avoids creating a new object each render which
// would trigger ShapeSource native reconciliation updates when layers are inactive.
const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type FeatureOrCollection = GeoJSON.FeatureCollection | GeoJSON.Feature;

export interface NearbyPolyline {
  id: string;
  name?: string;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  encodedPolyline: ArrayBuffer;
}

interface SectionMapLayersInput {
  section: FrequentSection;
  displayPoints: RoutePoint[];
  shadowTrack?: [number, number][];
  highlightedActivityId?: string | null;
  highlightedLapPoints?: RoutePoint[];
  allActivityTraces?: Record<string, RoutePoint[]>;
  trimRange?: { start: number; end: number } | null;
  extensionTrack?: RoutePoint[] | null;
  nearbyPolylines?: NearbyPolyline[];
}

export interface SectionMapLayers {
  sectionGeoJSON: FeatureOrCollection;
  trimmedGeoJSON: FeatureOrCollection;
  shadowGeoJSON: FeatureOrCollection;
  extensionGeoJSON: FeatureOrCollection;
  nearbyGeoJSON: GeoJSON.FeatureCollection;
  allTracesFeatureCollection: GeoJSON.FeatureCollection;
  hasAllTraces: boolean;
  highlightedTraceFilter: Expression | undefined;
  highlightedTraceGeoJSON: FeatureOrCollection;
  highlightedLapGeoJSON: FeatureOrCollection;
}

function isFinitePoint(p: RoutePoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function lineFeature(
  points: RoutePoint[],
  properties: GeoJSON.GeoJsonProperties = {}
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'LineString',
      coordinates: points.map((p) => [p.lng, p.lat]),
    },
  };
}

// Builds every GeoJSON overlay the section map renders: the section polyline,
// the trimmed/shadow/extension overlays for bounds editing, nearby sections,
// and the pre-loaded activity traces used for fast scrubbing.
export function useSectionMapLayers({
  section,
  displayPoints,
  shadowTrack,
  highlightedActivityId,
  highlightedLapPoints,
  allActivityTraces,
  trimRange,
  extensionTrack,
  nearbyPolylines,
}: SectionMapLayersInput): SectionMapLayers {
  const sectionGeoJSON = useMemo<FeatureOrCollection>(() => {
    const validPoints = displayPoints.filter(isFinitePoint);
    if (validPoints.length < 2) return EMPTY_COLLECTION;
    return lineFeature(validPoints);
  }, [displayPoints]);

  // In expand mode trim indices are relative to extensionTrack, not the polyline.
  const trimmedGeoJSON = useMemo<FeatureOrCollection>(() => {
    if (!trimRange) return EMPTY_COLLECTION;
    const sourcePoints =
      extensionTrack && extensionTrack.length > 0 ? extensionTrack : displayPoints;
    if (sourcePoints.length < 2) return EMPTY_COLLECTION;
    const validPoints = sourcePoints
      .slice(trimRange.start, trimRange.end + 1)
      .filter(isFinitePoint);
    if (validPoints.length < 2) return EMPTY_COLLECTION;
    return lineFeature(validPoints);
  }, [displayPoints, extensionTrack, trimRange]);

  const shadowGeoJSON = useMemo<FeatureOrCollection>(() => {
    if (!shadowTrack || shadowTrack.length < 2) return EMPTY_COLLECTION;
    const validCoords = shadowTrack.filter(
      ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
    );
    if (validCoords.length < 2) return EMPTY_COLLECTION;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: validCoords.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [shadowTrack]);

  const extensionGeoJSON = useMemo<FeatureOrCollection>(() => {
    if (!extensionTrack || extensionTrack.length < 2) return EMPTY_COLLECTION;
    const validCoords = extensionTrack.filter(isFinitePoint);
    if (validCoords.length < 2) return EMPTY_COLLECTION;
    return lineFeature(validCoords);
  }, [extensionTrack]);

  const nearbyGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!nearbyPolylines || nearbyPolylines.length === 0) return EMPTY_COLLECTION;
    const features = nearbyPolylines
      .map((entry) => {
        if (!entry.encodedPolyline) return null;
        const decoded = decodeCoords(entry.encodedPolyline);
        if (decoded.length < 2) return null;
        const coordinates: [number, number][] = decoded
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
          .map((p) => [p.longitude, p.latitude]);
        if (coordinates.length < 2) return null;
        return {
          type: 'Feature' as const,
          properties: { sectionId: entry.id },
          geometry: { type: 'LineString' as const, coordinates },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    return { type: 'FeatureCollection', features };
  }, [nearbyPolylines]);

  const allTracesFeatureCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!allActivityTraces || Object.keys(allActivityTraces).length === 0) return EMPTY_COLLECTION;
    const features = Object.entries(allActivityTraces)
      .map(([activityId, points]) => {
        if (!points) return null;
        const validPoints = points.filter(isFinitePoint);
        if (validPoints.length < 2) return null;
        return lineFeature(validPoints, { activityId });
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    return { type: 'FeatureCollection', features };
  }, [allActivityTraces]);

  const hasAllTraces = allTracesFeatureCollection.features.length > 0;

  const highlightedTraceFilter = useMemo<Expression | undefined>(() => {
    if (!highlightedActivityId || !hasAllTraces) return undefined;
    return ['==', ['get', 'activityId'], highlightedActivityId];
  }, [highlightedActivityId, hasAllTraces]);

  // Fallback trace when allActivityTraces is not provided. Lap points win, then
  // the section's stored trace for the highlighted activity.
  const highlightedTraceGeoJSON = useMemo<FeatureOrCollection>(() => {
    if (hasAllTraces) return EMPTY_COLLECTION;

    if (highlightedLapPoints && highlightedLapPoints.length > 1) {
      const validPoints = highlightedLapPoints.filter(isFinitePoint);
      if (validPoints.length < 2) return EMPTY_COLLECTION;
      return lineFeature(validPoints, { id: 'highlighted-lap' });
    }

    if (highlightedActivityId && section.activityTraces) {
      const activityTrace = section.activityTraces[highlightedActivityId];
      if (activityTrace && activityTrace.length > 1) {
        const validPoints = activityTrace.filter(isFinitePoint);
        if (validPoints.length < 2) return EMPTY_COLLECTION;
        return lineFeature(validPoints, { id: highlightedActivityId });
      }
    }

    return EMPTY_COLLECTION;
  }, [highlightedActivityId, highlightedLapPoints, section.activityTraces, hasAllTraces]);

  const highlightedLapGeoJSON = useMemo<FeatureOrCollection>(() => {
    if (!highlightedLapPoints || highlightedLapPoints.length < 2) return EMPTY_COLLECTION;
    const validPoints = highlightedLapPoints.filter(isFinitePoint);
    if (validPoints.length < 2) return EMPTY_COLLECTION;
    return lineFeature(validPoints, { id: 'highlighted-lap' });
  }, [highlightedLapPoints]);

  return {
    sectionGeoJSON,
    trimmedGeoJSON,
    shadowGeoJSON,
    extensionGeoJSON,
    nearbyGeoJSON,
    allTracesFeatureCollection,
    hasAllTraces,
    highlightedTraceFilter,
    highlightedTraceGeoJSON,
    highlightedLapGeoJSON,
  };
}

/**
 * A home and the radius around it, on a map small enough for a settings row.
 *
 * The circle is drawn on the ground rather than in pixels so it is the radius
 * the row is set to at any zoom. A tap moves the home, which is how a wrong
 * guess is corrected. Panning stays off so the list underneath still scrolls,
 * and zooming out then tapping reaches anything off screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/shared/app';
import { layout, mapLayerColors } from '@/theme';
import {
  EMPTY_FEATURE_COLLECTION,
  featureCollection,
  pointFeature,
  type LngLat,
} from '@/features/maps/lib/coordinates';
import type { MapCameraSpec, MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { circleBounds, circlePolygon } from '@/features/maps/lib/radiusCircle';
import { MapSurface, type MapPressEvent, type MapSurfaceRef } from './MapSurface';

export const HOME_RADIUS_MAP_HEIGHT = 180;

/** Street level. Past this the basemap has nothing more to show. */
const MAX_ZOOM = 17;
const FIT_PADDING = 24;
/** A circle smaller than this is fitted as if it were this, so a street stays legible. */
const MIN_FIT_M = 100;

const RADIUS_SOURCE = 'home-radius';
const HOME_SOURCE = 'home-point';

const LAYERS: MapLayerSpec[] = [
  {
    id: 'home-radius-fill',
    type: 'fill',
    source: RADIUS_SOURCE,
    paint: { 'fill-color': mapLayerColors.homeRadiusFill },
  },
  {
    id: 'home-radius-line',
    type: 'line',
    source: RADIUS_SOURCE,
    paint: { 'line-color': mapLayerColors.homeRadius, 'line-width': 2 },
  },
  {
    id: 'home-point',
    type: 'circle',
    source: HOME_SOURCE,
    paint: {
      'circle-radius': 7,
      'circle-color': mapLayerColors.homeRadius,
      'circle-stroke-color': mapLayerColors.casing,
      'circle-stroke-width': 2,
    },
  },
];

export interface HomeRadiusMapProps {
  home: LngLat;
  radiusM: number;
  onMove: (home: LngLat) => void;
  testID?: string;
}

export function homeRadiusCamera(home: LngLat, radiusM: number): MapCameraSpec {
  return {
    bounds: circleBounds(home, Math.max(radiusM, MIN_FIT_M)),
    padding: FIT_PADDING,
    maxZoom: MAX_ZOOM,
  };
}

export function HomeRadiusMap({ home, radiusM, onMove, testID }: HomeRadiusMapProps) {
  const { isDark } = useTheme();
  const surfaceRef = useRef<MapSurfaceRef>(null);

  const sources = useMemo<Record<string, MapSourceSpec>>(() => {
    const circle = circlePolygon(home, radiusM);
    return {
      [RADIUS_SOURCE]: {
        kind: 'geojson',
        data: circle ? featureCollection([circle]) : EMPTY_FEATURE_COLLECTION,
      },
      [HOME_SOURCE]: { kind: 'geojson', data: featureCollection([pointFeature(home)]) },
    };
  }, [home, radiusM]);

  // First paint takes the camera as a prop. Every later change goes through
  // the ref, since the page is never rebuilt for a camera move.
  const camera = useMemo(() => homeRadiusCamera(home, radiusM), [home, radiusM]);
  const [initialCamera] = useState(camera);
  useEffect(() => {
    if (camera !== initialCamera) surfaceRef.current?.setCamera(camera);
  }, [camera, initialCamera]);

  const handlePress = useCallback((event: MapPressEvent) => onMove(event.coordinate), [onMove]);

  return (
    <View style={styles.frame} testID={testID}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={isDark ? 'dark' : 'light'}
        initialCamera={initialCamera}
        sources={sources}
        layers={LAYERS}
        scrollEnabled={false}
        rotateEnabled={false}
        onPress={handlePress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: HOME_RADIUS_MAP_HEIGHT,
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
  },
});

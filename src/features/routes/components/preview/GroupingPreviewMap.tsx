/**
 * The routes the athlete has today, repainted by the previewed grouping.
 *
 * Nothing is regrouped here. The lines are the ones the routes screen already
 * draws; what the preview decides is which of them share a group at the chosen
 * setting, and the paint says so: the most-ridden group opaque, a pair the
 * setting would merge in the merge colour, and a route whose ride falls out of
 * every group faded to the casing grey, each with its own legend row.
 *
 * Every source stays mounted with an empty FeatureCollection when it has
 * nothing to draw, so a knob move is a data swap and never a layer rebuild.
 */

import React, { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { decodeCoords } from 'veloqrs';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app/useTheme';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  EMPTY_FEATURE_COLLECTION,
  MapSurface,
  boundsOfLngLat,
  type LngLat,
  type MapCameraSpec,
  type MapLayerSpec,
  type MapSourceSpec,
  type MapStyleType,
  type MapSurfaceRef,
} from '@/features/maps';
import type { PaintedRoute } from '../../lib/groupingParams';
import { GROUPING_LAYER_PAINT as PAINT, groupingLegendRows } from '../../lib/groupingLegend';

/** One of today's routes, with the line the routes screen already holds. */
export interface GroupingRoute {
  groupId: string;
  encodedPolyline: ArrayBuffer;
  /** The route's own box, for framing. Absent on a route with no track. */
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined;
}

interface GroupingPreviewMapProps {
  routes: GroupingRoute[];
  /** The paint for each route, or empty until a preview has answered. */
  painted: PaintedRoute[];
  /** Every route the setting would merge, the largest group's included. */
  mergedCount: number;
  mapStyle: MapStyleType;
}

function collection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return features.length === 0 ? EMPTY_FEATURE_COLLECTION : { type: 'FeatureCollection', features };
}

export function GroupingPreviewMap({
  routes,
  painted,
  mergedCount,
  mapStyle,
}: GroupingPreviewMapProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surfaceRef = useRef<MapSurfaceRef>(null);

  const lines = useMemo(() => {
    const byId = new Map<string, LngLat[]>();
    for (const route of routes) {
      const points = decodeCoords(route.encodedPolyline);
      if (points.length >= 2) {
        byId.set(
          route.groupId,
          points.map((p) => [p.longitude, p.latitude] as LngLat)
        );
      }
    }
    return byId;
  }, [routes]);

  const features = useMemo(() => {
    const paintOf = new Map(painted.map((p) => [p.groupId, p]));
    const largest: GeoJSON.Feature[] = [];
    const merging: GeoJSON.Feature[] = [];
    const other: GeoJSON.Feature[] = [];
    const dropped: GeoJSON.Feature[] = [];

    for (const route of routes) {
      const coords = lines.get(route.groupId);
      if (!coords) continue;
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        id: route.groupId,
        properties: { groupId: route.groupId },
        geometry: { type: 'LineString', coordinates: coords },
      };
      const paint = paintOf.get(route.groupId);
      // Before the first answer every route draws as itself, which is the
      // routes screen's own picture rather than a claim about the setting.
      if (!paint) other.push(feature);
      else if (paint.previewKey === null) dropped.push(feature);
      else if (paint.isLargest) largest.push(feature);
      else if (paint.mergesWithAnother) merging.push(feature);
      else other.push(feature);
    }
    return { largest, merging, other, dropped };
  }, [routes, lines, painted]);

  // The map frames itself from the boxes it was given, so the screen never has
  // to reach into the map feature to build a camera.
  const initialCamera: MapCameraSpec = useMemo(() => {
    const corners: LngLat[] = [];
    for (const route of routes) {
      if (!route.bounds) continue;
      corners.push([route.bounds.minLng, route.bounds.minLat]);
      corners.push([route.bounds.maxLng, route.bounds.maxLat]);
    }
    const bounds = boundsOfLngLat(corners);
    return bounds ? { bounds, padding: spacing.lg } : { center: [0, 0], zoom: 2 };
  }, [routes]);

  const sources: Record<string, MapSourceSpec> = useMemo(
    () => ({
      'grouping-dropped': { kind: 'geojson', data: collection(features.dropped) },
      'grouping-other': { kind: 'geojson', data: collection(features.other) },
      'grouping-merging': { kind: 'geojson', data: collection(features.merging) },
      'grouping-largest': { kind: 'geojson', data: collection(features.largest) },
    }),
    [features]
  );

  const layers: MapLayerSpec[] = useMemo(() => {
    const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
    return [
      {
        id: 'grouping-dropped-line',
        type: 'line',
        source: 'grouping-dropped',
        layout: roundLine,
        paint: {
          'line-color': PAINT.dropped.colour,
          'line-opacity': PAINT.dropped.opacity,
          'line-width': PAINT.dropped.width,
          'line-dasharray': [3, 3],
        },
      },
      {
        id: 'grouping-other-line',
        type: 'line',
        source: 'grouping-other',
        layout: roundLine,
        paint: {
          'line-color': PAINT.other.colour,
          'line-opacity': PAINT.other.opacity,
          'line-width': PAINT.other.width,
        },
      },
      {
        id: 'grouping-merging-line',
        type: 'line',
        source: 'grouping-merging',
        layout: roundLine,
        paint: {
          'line-color': PAINT.merging.colour,
          'line-opacity': PAINT.merging.opacity,
          'line-width': PAINT.merging.width,
        },
      },
      {
        id: 'grouping-largest-line',
        type: 'line',
        source: 'grouping-largest',
        layout: roundLine,
        paint: {
          'line-color': PAINT.largest.colour,
          'line-opacity': PAINT.largest.opacity,
          'line-width': PAINT.largest.width,
        },
      },
    ];
  }, []);

  const chipBg = isDark ? darkColors.surface : colors.surface;
  const chipBorder = isDark ? darkColors.border : colors.border;
  const chipText = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.container}>
      <MapSurface
        ref={surfaceRef}
        mapStyle={mapStyle}
        initialCamera={initialCamera}
        sources={sources}
        layers={layers}
        testID="grouping-preview-map"
      />
      <View
        style={[styles.legend, { backgroundColor: chipBg, borderColor: chipBorder }]}
        pointerEvents="none"
      >
        {groupingLegendRows(mergedCount).map((row) => (
          <LegendRow
            key={row.kind}
            colour={row.colour}
            opacity={row.opacity}
            label={t(row.labelKey, { count: row.count ?? 0 })}
            textColour={chipText}
          />
        ))}
      </View>
    </View>
  );
}

function LegendRow({
  colour,
  opacity,
  label,
  textColour,
}: {
  colour: string;
  opacity: number;
  label: string;
  textColour: string;
}) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: colour, opacity }]} />
      <Text style={[styles.legendLabel, { color: textColour }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', borderRadius: layout.borderRadius },
  legend: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 12, height: 3, borderRadius: layout.borderRadiusFull },
  legendLabel: { ...typography.caption },
});

/**
 * HeatmapLayer component for MapLibre.
 * Renders heatmap cells as circles with density-based coloring.
 */

import React, { useMemo } from 'react';
import { NativeSyntheticEvent } from 'react-native';
import { GeoJSONSource, CircleLayer } from '@maplibre/maplibre-react-native';
import type { PressEventWithFeatures } from '@maplibre/maplibre-react-native';
import { colors } from '@/theme';
import type { HeatmapResult } from '@/hooks/useHeatmap';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface HeatmapLayerProps {
  /** Heatmap data from useHeatmap (can be null when not in heatmap mode) */
  heatmap: HeatmapResult | null;
  /** Called when a cell is tapped */
  onCellPress?: (row: number, col: number) => void;
  /** Opacity of the heatmap (0-1) */
  opacity?: number;
  /** Whether to show common paths differently */
  highlightCommonPaths?: boolean;
  /** Whether the heatmap is visible (iOS crash fix: always render, control via opacity) */
  visible?: boolean;
}

// Color stops for density gradient (blue -> purple -> gold)
// Premium brand palette: no orange
const DENSITY_COLORS: any[] = [
  'interpolate',
  ['linear'],
  ['get', 'density'],
  0,
  '#7DB3E3', // Light blue - low density
  0.25,
  '#5B9BD5', // Brand blue
  0.5,
  '#A855F7', // Purple - medium density
  0.75,
  '#D4AF37', // Gold - high density
  1.0,
  '#B8942F', // Dark gold - highest density
];

// Circle radius based on cell size and density
const CIRCLE_RADIUS: any[] = ['interpolate', ['linear'], ['get', 'density'], 0, 4, 0.5, 6, 1.0, 8];

export function HeatmapLayer({
  heatmap,
  onCellPress,
  opacity = 0.7,
  highlightCommonPaths = true,
  visible = true,
}: HeatmapLayerProps) {
  // Convert heatmap cells to GeoJSON
  // iOS crash fix: Always return valid GeoJSON, never null
  const geoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!heatmap || heatmap.cells.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    let skippedCount = 0;
    const features: GeoJSON.Feature[] = heatmap.cells
      .map((cell) => {
        // Validate coordinates
        if (!Number.isFinite(cell.centerLng) || !Number.isFinite(cell.centerLat)) {
          skippedCount++;
          if (__DEV__) {
            console.warn(
              `[HeatmapLayer] INVALID CELL: row=${cell.row} col=${cell.col} centerLng=${cell.centerLng} centerLat=${cell.centerLat}`
            );
          }
          return null;
        }

        return {
          type: 'Feature' as const,
          id: `cell-${cell.row}-${cell.col}`,
          properties: {
            row: cell.row,
            col: cell.col,
            density: cell.density,
            visitCount: cell.visitCount,
            uniqueRouteCount: cell.uniqueRouteCount,
            activityCount: cell.activityIds.length,
            isCommonPath: cell.isCommonPath,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [cell.centerLng, cell.centerLat],
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (__DEV__ && skippedCount > 0) {
      console.warn(
        `[HeatmapLayer] Skipped ${skippedCount}/${heatmap.cells.length} cells with invalid coordinates`
      );
    }

    return { type: 'FeatureCollection', features };
  }, [heatmap]);

  // Handle cell press
  const handlePress = (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    if (!onCellPress) return;
    const feature = event.nativeEvent.features?.[0];
    if (feature?.properties) {
      onCellPress(feature.properties.row as number, feature.properties.col as number);
    }
  };

  // iOS crash fix: Always render the GeoJSONSource, use opacity to hide
  // Never return null to avoid triggering native add/remove operations
  const effectiveOpacity = visible && geoJSON.features.length > 0 ? opacity : 0;

  return (
    <GeoJSONSource
      id="heatmap-cells"
      data={geoJSON}
      onPress={visible ? handlePress : undefined}
      hitbox={{ top: 10, right: 10, bottom: 10, left: 10 }}
    >
      {/* Main heatmap circles */}
      {/* Note: MapLibre style expressions are arrays but TS types expect primitives */}
      <CircleLayer
        id="heatmap-circles"
        style={{
          circleRadius: visible ? (CIRCLE_RADIUS as any) : 0,
          circleColor: DENSITY_COLORS as any,
          circleOpacity: effectiveOpacity,
          circleStrokeWidth:
            visible && highlightCommonPaths
              ? (['case', ['get', 'isCommonPath'], 1.5, 0] as any)
              : 0,
          circleStrokeColor: colors.textOnDark,
        }}
      />
    </GeoJSONSource>
  );
}

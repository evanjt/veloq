/**
 * HeatmapLayer component for MapLibre.
 * Renders heatmap cells as circles with density-based coloring.
 */

import React, { useMemo } from 'react';
import { ShapeSource, CircleLayer } from '@maplibre/maplibre-react-native';
import type { HeatmapResult } from '@/hooks/useHeatmap';

// MapLibre expression type - allows style expressions that TypeScript types don't fully support
type MapLibreExpression = (string | number | (string | number)[])[];

interface HeatmapLayerProps {
  /** Heatmap data from useHeatmap */
  heatmap: HeatmapResult;
  /** Called when a cell is tapped */
  onCellPress?: (row: number, col: number) => void;
  /** Opacity of the heatmap (0-1) */
  opacity?: number;
  /** Whether to show common paths differently */
  highlightCommonPaths?: boolean;
}

// Color stops for density gradient (yellow -> orange -> red)
const DENSITY_COLORS: MapLibreExpression = [
  'interpolate',
  ['linear'],
  ['get', 'density'],
  0, '#FFEB3B',      // Yellow - low density
  0.3, '#FFC107',    // Amber
  0.5, '#FF9800',    // Orange
  0.7, '#FF5722',    // Deep orange
  1.0, '#F44336',    // Red - high density
];

// Circle radius based on cell size and density
const CIRCLE_RADIUS: MapLibreExpression = [
  'interpolate',
  ['linear'],
  ['get', 'density'],
  0, 4,
  0.5, 6,
  1.0, 8,
];

export function HeatmapLayer({
  heatmap,
  onCellPress,
  opacity = 0.7,
  highlightCommonPaths = true,
}: HeatmapLayerProps) {
  // Convert heatmap cells to GeoJSON
  const geoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!heatmap || heatmap.cells.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    const features: GeoJSON.Feature[] = heatmap.cells.map((cell) => ({
      type: 'Feature',
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
        type: 'Point',
        coordinates: [cell.centerLng, cell.centerLat],
      },
    }));

    return { type: 'FeatureCollection', features };
  }, [heatmap]);

  // Handle cell press
  const handlePress = (event: { features?: GeoJSON.Feature[] }) => {
    if (!onCellPress) return;
    const feature = event.features?.[0];
    if (feature?.properties) {
      onCellPress(
        feature.properties.row as number,
        feature.properties.col as number
      );
    }
  };

  if (geoJSON.features.length === 0) {
    return null;
  }

  return (
    <ShapeSource
      id="heatmap-cells"
      shape={geoJSON}
      onPress={handlePress}
      hitbox={{ width: 20, height: 20 }}
    >
      {/* Main heatmap circles */}
      {/* Note: MapLibre style expressions are arrays but TS types expect primitives */}
      <CircleLayer
        id="heatmap-circles"
        style={{
          circleRadius: CIRCLE_RADIUS as number,
          circleColor: DENSITY_COLORS as string,
          circleOpacity: opacity,
          circleStrokeWidth: (highlightCommonPaths ? [
            'case',
            ['get', 'isCommonPath'],
            1.5,
            0,
          ] : 0) as number,
          circleStrokeColor: '#FFFFFF',
        }}
      />
    </ShapeSource>
  );
}

/**
 * HeatmapLayer component for MapLibre.
 * Renders heatmap cells as circles with density-based coloring.
 */

import React, { useMemo } from 'react';
import { ShapeSource, CircleLayer } from '@maplibre/maplibre-react-native';
import type { HeatmapResult } from '@/hooks/useHeatmap';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
const CIRCLE_RADIUS: any[] = [
  'interpolate',
  ['linear'],
  ['get', 'density'],
  0,
  4,
  0.5,
  6,
  1.0,
  8,
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
      onCellPress(feature.properties.row as number, feature.properties.col as number);
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
          circleRadius: CIRCLE_RADIUS as any,
          circleColor: DENSITY_COLORS as any,
          circleOpacity: opacity,
          circleStrokeWidth: highlightCommonPaths
            ? (['case', ['get', 'isCommonPath'], 1.5, 0] as any)
            : 0,
          circleStrokeColor: '#FFFFFF',
        }}
      />
    </ShapeSource>
  );
}

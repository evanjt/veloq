/**
 * @fileoverview HighlightRenderer - Elevation chart crosshair marker
 *
 * Renders a marker on the map at the position corresponding to
 * the elevation chart crosshair selection. Supports camera following.
 */

import React, { useMemo, useEffect, useCallback } from 'react';
import { MarkerView } from '@maplibre/maplibre-react-native';
import { View, StyleSheet } from 'react-native';
import type { Camera } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@/lib';

interface HighlightRendererProps {
  /** Index into coordinates array to highlight */
  highlightIndex: number | null;
  /** All coordinates for the activity */
  coordinates: LatLng[];
  /** MapLibre Camera ref for programmatic control */
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  /** Whether camera should follow the highlight */
  followHighlight?: boolean;
}

/**
 * Highlight marker for elevation chart crosshair.
 *
 * Shows a circular marker at the highlighted position on the map.
 * Optionally animates the camera to follow the highlight.
 *
 * @example
 * ```tsx
 * <HighlightRenderer
 *   highlightIndex={chartPointIndex}
 *   coordinates={activityCoordinates}
 *   cameraRef={cameraRef}
 *   followHighlight={true}
 * />
 * ```
 */
export function HighlightRenderer({
  highlightIndex,
  coordinates,
  cameraRef,
  followHighlight = false,
}: HighlightRendererProps) {
  // Get the highlighted point from elevation chart selection
  const highlightPoint = useMemo(() => {
    if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < coordinates.length) {
      const coord = coordinates[highlightIndex];
      if (coord && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
        return coord;
      }
    }
    return null;
  }, [highlightIndex, coordinates]);

  // Animate camera to follow highlight when it changes
  useEffect(() => {
    if (!followHighlight || !highlightPoint) return;

    // Animate camera to highlight position
    cameraRef.current?.setCamera({
      centerCoordinate: [highlightPoint.longitude, highlightPoint.latitude],
      zoomLevel: 15, // Close zoom to see the point clearly
      animationDuration: 300,
    });
  }, [followHighlight, highlightPoint, cameraRef]);

  // Don't render if no highlight point
  if (!highlightPoint) {
    return null;
  }

  return (
    <MarkerView
      coordinate={[highlightPoint.longitude, highlightPoint.latitude]}
      id="highlight-marker"
    >
      <View style={styles.marker}>
        <View style={styles.innerMarker} />
      </View>
    </MarkerView>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(252, 76, 2, 0.3)', // Primary color with opacity
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FBBF24', // Primary color
  },
  innerMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FBBF24',
  },
});

import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Path, Circle } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { colors, spacing, opacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { RoutePoint } from '@/types';
import type { LayoutChangeEvent } from 'react-native';

const MAP_HEIGHT = 150;
const MAP_PADDING = 16;

interface SectionInsightMapProps {
  polyline: RoutePoint[];
  /** Line color for the section polyline */
  lineColor?: string;
}

/**
 * Lightweight static polyline map for insight detail views.
 * Uses Skia Canvas to render the section polyline without the overhead
 * of a full MapLibre map instance (no tiles, no 3D, no controls).
 */
export const SectionInsightMap = React.memo(function SectionInsightMap({
  polyline,
  lineColor = colors.primary,
}: SectionInsightMapProps) {
  const { isDark } = useTheme();
  const [mapWidth, setMapWidth] = useState(0);
  const onMapLayout = useCallback((e: LayoutChangeEvent) => {
    setMapWidth(e.nativeEvent.layout.width);
  }, []);

  const { linePath, startPoint, endPoint } = useMemo(() => {
    if (polyline.length < 2 || mapWidth <= 0) {
      return { linePath: '', startPoint: null, endPoint: null };
    }

    // Find bounds
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of polyline) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;

    // Apply Mercator-like scaling for latitude
    const midLat = (minLat + maxLat) / 2;
    const latCos = Math.cos((midLat * Math.PI) / 180);

    // Compute aspect ratio and fit to available area
    const drawW = mapWidth - MAP_PADDING * 2;
    const drawH = MAP_HEIGHT - MAP_PADDING * 2;
    const dataAspect = (lngRange * latCos) / latRange;
    const viewAspect = drawW / drawH;

    let scaleX: number;
    let scaleY: number;
    let offsetX: number;
    let offsetY: number;

    if (dataAspect > viewAspect) {
      // Width-constrained
      scaleX = drawW / (lngRange * latCos);
      scaleY = scaleX;
      offsetX = MAP_PADDING;
      offsetY = MAP_PADDING + (drawH - latRange * scaleY) / 2;
    } else {
      // Height-constrained
      scaleY = drawH / latRange;
      scaleX = scaleY;
      offsetX = MAP_PADDING + (drawW - lngRange * latCos * scaleX) / 2;
      offsetY = MAP_PADDING;
    }

    const toX = (lng: number) => offsetX + (lng - minLng) * latCos * scaleX;
    const toY = (lat: number) => offsetY + (maxLat - lat) * scaleY;

    // Build SVG path
    const validPoints = polyline.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 2) return { linePath: '', startPoint: null, endPoint: null };

    let d = `M ${toX(validPoints[0].lng)} ${toY(validPoints[0].lat)}`;
    for (let i = 1; i < validPoints.length; i++) {
      d += ` L ${toX(validPoints[i].lng)} ${toY(validPoints[i].lat)}`;
    }

    const first = validPoints[0];
    const last = validPoints[validPoints.length - 1];

    return {
      linePath: d,
      startPoint: { x: toX(first.lng), y: toY(first.lat) },
      endPoint: { x: toX(last.lng), y: toY(last.lat) },
    };
  }, [polyline, mapWidth]);

  if (polyline.length < 2 || !linePath) return null;

  const bgColor = isDark ? opacity.overlayDark.light : opacity.overlay.subtle;

  return (
    <ChartErrorBoundary height={MAP_HEIGHT}>
      <View style={[styles.container, { backgroundColor: bgColor }]} onLayout={onMapLayout}>
        {mapWidth > 0 ? (
          <Canvas style={{ width: mapWidth, height: MAP_HEIGHT }}>
            {/* Route line shadow */}
            <Path
              path={linePath}
              style="stroke"
              strokeWidth={5}
              color={isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}
              strokeCap="round"
              strokeJoin="round"
            />
            {/* Route line */}
            <Path
              path={linePath}
              style="stroke"
              strokeWidth={3}
              color={lineColor}
              strokeCap="round"
              strokeJoin="round"
            />
            {/* Start point */}
            {startPoint && (
              <>
                <Circle cx={startPoint.x} cy={startPoint.y} r={5} color={lineColor} />
                <Circle cx={startPoint.x} cy={startPoint.y} r={3} color="#FFFFFF" />
              </>
            )}
            {/* End point */}
            {endPoint && (
              <>
                <Circle cx={endPoint.x} cy={endPoint.y} r={5} color={lineColor} />
                <Circle cx={endPoint.x} cy={endPoint.y} r={2} color="#FFFFFF" />
              </>
            )}
          </Canvas>
        ) : null}
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
});

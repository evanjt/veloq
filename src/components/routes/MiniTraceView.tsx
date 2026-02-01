/**
 * Mini trace visualization for activity rows.
 * Shows an activity's GPS trace overlaid on a reference trace (route or section).
 * Used in both route and section detail pages for consistent visualization.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import { colors } from '@/theme';
import type { RoutePoint } from '@/types';

interface MiniTraceViewProps {
  /** Primary trace points (the activity's GPS path) */
  primaryPoints: RoutePoint[];
  /** Reference trace points (route or section for comparison, shown underneath) */
  referencePoints?: RoutePoint[];
  /** Color for the primary trace */
  primaryColor: string;
  /** Color for the reference trace */
  referenceColor: string;
  /** Whether this trace is currently highlighted/selected */
  isHighlighted?: boolean;
  /** Size of the trace view (default 56) - used for square views or as width */
  size?: number;
  /** Width of the trace view (overrides size) */
  width?: number;
  /** Height of the trace view (default 40, or size if square) */
  height?: number;
  /** Whether to use dark mode styling */
  isDark?: boolean;
  /** Whether to show start/end markers */
  showMarkers?: boolean;
}

export function MiniTraceView({
  primaryPoints,
  referencePoints,
  primaryColor,
  referenceColor,
  isHighlighted = false,
  size = 56,
  width: propWidth,
  height: propHeight,
  isDark = false,
  showMarkers = true,
}: MiniTraceViewProps) {
  // Calculate actual dimensions
  const width = propWidth ?? size;
  const height = propHeight ?? (propWidth ? 40 : size);

  // Background colors for map-like appearance
  const bgColor = isDark ? '#1a2a1a' : '#e8f4e8';
  const bgColorBottom = isDark ? '#0d1a0d' : '#d4e8d4';
  const gridColor = isDark ? '#2a3a2a' : '#d0e8d0';

  // Memoize all the expensive coordinate calculations
  const { primaryString, referenceString, startPoint, endPoint } = useMemo(() => {
    // Filter out invalid points (NaN coordinates would crash SVG renderer)
    const isValidPoint = (p: RoutePoint) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

    const validPrimaryPoints = primaryPoints.filter(isValidPoint);
    const validReferencePoints = referencePoints?.filter(isValidPoint);

    if (validPrimaryPoints.length < 2) return { primaryString: null, referenceString: null };

    const padding = 3;

    // Combine all points to calculate shared bounds
    const allPoints =
      validReferencePoints && validReferencePoints.length > 0
        ? [...validPrimaryPoints, ...validReferencePoints]
        : validPrimaryPoints;

    const lats = allPoints.map((p) => p.lat);
    const lngs = allPoints.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latRange = maxLat - minLat || 0.0001;
    const lngRange = maxLng - minLng || 0.0001;

    // Calculate draw area
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    // Use uniform scaling to preserve aspect ratio (fit within bounds)
    const scaleX = drawWidth / lngRange;
    const scaleY = drawHeight / latRange;
    const scale = Math.min(scaleX, scaleY);

    // Center the trace in the available space
    const scaledLngRange = lngRange * scale;
    const scaledLatRange = latRange * scale;
    const offsetX = (drawWidth - scaledLngRange) / 2 + padding;
    const offsetY = (drawHeight - scaledLatRange) / 2 + padding;

    // Scale function using uniform bounds (preserves geometry)
    const scalePoints = (points: RoutePoint[]) =>
      points.map((p) => ({
        x: (p.lng - minLng) * scale + offsetX,
        y: drawHeight - (p.lat - minLat) * scale + offsetY - (drawHeight - scaledLatRange) / 2,
      }));

    const primaryScaled = scalePoints(validPrimaryPoints);
    const primary = primaryScaled.map((p) => `${p.x},${p.y}`).join(' ');

    const referenceScaled =
      validReferencePoints && validReferencePoints.length > 1
        ? scalePoints(validReferencePoints)
        : null;
    const reference = referenceScaled
      ? referenceScaled.map((p) => `${p.x},${p.y}`).join(' ')
      : null;

    // Get start and end points for markers
    const start = primaryScaled[0];
    const end = primaryScaled[primaryScaled.length - 1];

    return { primaryString: primary, referenceString: reference, startPoint: start, endPoint: end };
  }, [primaryPoints, referencePoints, width, height]);

  if (!primaryString) {
    // This means useMemo returned null for primaryString
    return null;
  }

  return (
    <View style={[styles.container, { width, height }, isHighlighted && styles.highlighted]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="mapGradientMini" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
            <Stop offset="1" stopColor={bgColorBottom} stopOpacity="1" />
          </LinearGradient>
        </Defs>

        {/* Map-like background */}
        <Rect x="0" y="0" width={width} height={height} fill="url(#mapGradientMini)" rx="6" />

        {/* Subtle grid lines for map effect */}
        <Polyline
          points={`${width / 3},0 ${width / 3},${height}`}
          stroke={gridColor}
          strokeWidth={0.5}
          strokeOpacity={0.5}
        />
        <Polyline
          points={`${(2 * width) / 3},0 ${(2 * width) / 3},${height}`}
          stroke={gridColor}
          strokeWidth={0.5}
          strokeOpacity={0.5}
        />
        <Polyline
          points={`0,${height / 2} ${width},${height / 2}`}
          stroke={gridColor}
          strokeWidth={0.5}
          strokeOpacity={0.5}
        />

        {/* Reference trace underneath (faded - route/section for comparison) */}
        {referenceString && (
          <Polyline
            points={referenceString}
            fill="none"
            stroke={referenceColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isHighlighted ? 0.3 : 0.2}
          />
        )}

        {/* Shadow for depth */}
        <Polyline
          points={primaryString}
          fill="none"
          stroke="#000000"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={0.15}
          transform="translate(0.5, 0.5)"
        />

        {/* Primary trace on top (prominent - this activity's actual path) */}
        <Polyline
          points={primaryString}
          fill="none"
          stroke={primaryColor}
          strokeWidth={isHighlighted ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Start marker (green) */}
        {showMarkers && startPoint && (
          <>
            <Circle cx={startPoint.x} cy={startPoint.y} r={3} fill={colors.success} />
            <Circle cx={startPoint.x} cy={startPoint.y} r={2} fill="#FFFFFF" />
          </>
        )}

        {/* End marker (red) */}
        {showMarkers && endPoint && (
          <>
            <Circle cx={endPoint.x} cy={endPoint.y} r={3} fill={colors.error} />
            <Circle cx={endPoint.x} cy={endPoint.y} r={2} fill="#FFFFFF" />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  highlighted: {
    borderWidth: 2,
    borderColor: colors.chartCyan,
  },
});

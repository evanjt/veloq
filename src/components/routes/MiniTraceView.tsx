/**
 * Mini trace visualization for activity rows.
 * Shows an activity's GPS trace overlaid on a reference trace (route or section).
 * Used in both route and section detail pages for consistent visualization.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
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
  /** Size of the trace view (default 36) */
  size?: number;
}

export function MiniTraceView({
  primaryPoints,
  referencePoints,
  primaryColor,
  referenceColor,
  isHighlighted = false,
  size = 36,
}: MiniTraceViewProps) {
  // Memoize all the expensive coordinate calculations
  const { primaryString, referenceString } = useMemo(() => {
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
    // Use uniform scaling to preserve aspect ratio (prevents distortion)
    const range = Math.max(latRange, lngRange);

    // Center the trace in the available space
    const drawSize = size - padding * 2;
    const latOffset = (range - latRange) / 2;
    const lngOffset = (range - lngRange) / 2;

    // Scale function using uniform bounds (preserves geometry)
    const scalePoints = (points: RoutePoint[]) =>
      points.map((p) => ({
        x: ((p.lng - minLng + lngOffset) / range) * drawSize + padding,
        y: (1 - (p.lat - minLat + latOffset) / range) * drawSize + padding,
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

    return { primaryString: primary, referenceString: reference };
  }, [primaryPoints, referencePoints, size]);

  if (!primaryString) return null;

  return (
    <View
      style={[styles.container, { width: size, height: size }, isHighlighted && styles.highlighted]}
    >
      <Svg width={size} height={size}>
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
        {/* Primary trace on top (prominent - this activity's actual path) */}
        <Polyline
          points={primaryString}
          fill="none"
          stroke={primaryColor}
          strokeWidth={isHighlighted ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  highlighted: {
    backgroundColor: colors.chartCyan + '26',
    borderWidth: 1,
    borderColor: colors.chartCyan,
  },
});

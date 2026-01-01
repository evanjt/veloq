/**
 * Mini trace visualization for activity rows.
 * Shows an activity's GPS trace overlaid on a reference trace (route or section).
 * Used in both route and section detail pages for consistent visualization.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
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
  if (primaryPoints.length < 2) return null;

  const padding = 3;

  // Combine all points to calculate shared bounds
  const allPoints = referencePoints && referencePoints.length > 0
    ? [...primaryPoints, ...referencePoints]
    : primaryPoints;

  const lats = allPoints.map(p => p.lat);
  const lngs = allPoints.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  // Scale function using shared bounds
  const scalePoints = (points: RoutePoint[]) =>
    points.map(p => ({
      x: ((p.lng - minLng) / lngRange) * (size - padding * 2) + padding,
      y: (1 - (p.lat - minLat) / latRange) * (size - padding * 2) + padding,
    }));

  const primaryScaled = scalePoints(primaryPoints);
  const primaryString = primaryScaled.map(p => `${p.x},${p.y}`).join(' ');

  const referenceScaled = referencePoints && referencePoints.length > 1
    ? scalePoints(referencePoints)
    : null;
  const referenceString = referenceScaled
    ? referenceScaled.map(p => `${p.x},${p.y}`).join(' ')
    : null;

  return (
    <View style={[
      styles.container,
      { width: size, height: size },
      isHighlighted && styles.highlighted,
    ]}>
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
    backgroundColor: 'rgba(0, 188, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#00BCD4',
  },
});

/**
 * A track as a thumbnail: the line over a map-like backdrop, with a start and
 * a finish marker.
 *
 * Lifted out of the routes row so the insight cards draw a section the same
 * way. It takes points already normalised to 0..1 because the routes list
 * holds them that way, and `normalizeTrackPoints` is the conversion for a
 * caller that holds coordinates instead.
 */

import React, { memo, useId } from 'react';
import Svg, { Polyline, Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';

import { colors, mapPreviewColors, ink } from '@/theme';
import type { LatLngShort } from '@/shared/geo/distance';

export interface NormalisedPoint {
  x: number;
  y: number;
}

/** Coordinates to 0..1 of their own bounding box, y flipped for the screen. */
export function normalizeTrackPoints(points: LatLngShort[]): NormalisedPoint[] {
  if (points.length < 2) return [];

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  return points.map((p) => ({
    x: (p.lng - minLng) / lngRange,
    y: 1 - (p.lat - minLat) / latRange,
  }));
}

interface TrackPreviewProps {
  points: NormalisedPoint[];
  color: string;
  isDark: boolean;
  width?: number;
  height?: number;
  testID?: string;
}

export const TrackPreview = memo(function TrackPreview({
  points,
  color,
  isDark,
  width = 48,
  height = 36,
  testID,
}: TrackPreviewProps) {
  // Unique ID for SVG gradient to avoid collisions between multiple instances
  const uniqueId = useId();
  const gradientId = `trackGradient-${uniqueId}`;

  if (points.length < 2) return null;

  const padding = 4;

  const scaledPoints = points.map((p) => ({
    x: p.x * (width - padding * 2) + padding,
    y: p.y * (height - padding * 2) + padding,
  }));

  const pointsString = scaledPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const startPoint = scaledPoints[0];
  const endPoint = scaledPoints[scaledPoints.length - 1];

  const preview = isDark ? mapPreviewColors.dark : mapPreviewColors.light;
  const bgColor = preview.bg;
  const gridColor = preview.grid;

  return (
    <Svg width={width} height={height} {...(testID !== undefined && { testID })}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
          <Stop offset="1" stopColor={preview.bgBottom} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width={width} height={height} fill={`url(#${gradientId})`} rx="4" />

      {/* Grid lines, so the backdrop reads as a map rather than a panel */}
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

      {/* Shadow under the line, for depth against the backdrop */}
      <Polyline
        points={pointsString}
        fill="none"
        stroke={ink.black}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.15}
        transform="translate(0.5, 0.5)"
      />

      <Polyline
        points={pointsString}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <Circle cx={startPoint.x} cy={startPoint.y} r={3} fill={colors.success} />
      <Circle cx={startPoint.x} cy={startPoint.y} r={2} fill={ink.white} />

      <Circle cx={endPoint.x} cy={endPoint.y} r={3} fill={colors.error} />
      <Circle cx={endPoint.x} cy={endPoint.y} r={2} fill={ink.white} />
    </Svg>
  );
});

/**
 * A track as a thumbnail: the line on its casing over the base map's flat land,
 * with a start and a finish marker of different shapes. Every list row, card
 * and sheet that pictures a track draws it through this one component.
 *
 * Lifted out of the routes row so the insight cards draw a section the same
 * way. It takes points already normalised because the routes list holds them
 * that way, and `normaliseTrackPoints` is the conversion for a caller that
 * holds coordinates instead. Either way the box is filled with one scale on
 * both axes, so the points' own proportions are what is drawn.
 */

import React, { memo } from 'react';
import Svg, { Polyline, Rect } from 'react-native-svg';

import { layout, mapPalette, stroke, type VectorMapPalette } from '@/theme';
import type { LatLngShort } from '@/shared/geo/distance';
import { projectRouteToBox } from '@/shared/geo/routePreview';
import { TrackEndpointMarkers } from '@/shared/ui/TrackEndpointMarkers';

export interface NormalisedPoint {
  x: number;
  y: number;
}

/**
 * Coordinates into the unit square with their geographic shape kept: longitude
 * is compressed by cos(latitude), one scale serves both axes and the shorter
 * axis is centred, so the longer one spans 0..1. y is flipped for the screen.
 * A coordinate that is not a finite number is dropped rather than drawn.
 */
export function normaliseTrackPoints(points: LatLngShort[]): NormalisedPoint[] {
  return projectRouteToBox(
    points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ latitude: p.lat, longitude: p.lng })),
    1,
    1,
    0
  );
}

/**
 * Points into a width by height box with one scale on both axes, so the shape
 * they were given is the shape drawn. The line is centred on the axis it does
 * not fill.
 */
export function fitTrackToBox(
  points: NormalisedPoint[],
  width: number,
  height: number,
  padding: number
): NormalisedPoint[] {
  if (points.length === 0) return [];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;

  const boxW = Math.max(1, width - padding * 2);
  const boxH = Math.max(1, height - padding * 2);
  const scaleX = spanX > 0 ? boxW / spanX : Infinity;
  const scaleY = spanY > 0 ? boxH / spanY : Infinity;
  const scale = Number.isFinite(Math.min(scaleX, scaleY)) ? Math.min(scaleX, scaleY) : 0;

  const offsetX = padding + (boxW - spanX * scale) / 2;
  const offsetY = padding + (boxH - spanY * scale) / 2;

  return points.map((p) => ({
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (p.y - minY) * scale,
  }));
}

interface TrackPreviewProps {
  points: NormalisedPoint[];
  isDark: boolean;
  width?: number;
  height?: number;
  testID?: string;
}

/** The line's width. Its casing shows one stroke either side of it. */
const LINE_WIDTH = 2.5;
const CASING_WIDTH = LINE_WIDTH + stroke.one * 2;
const PADDING = 4;

/**
 * The base map a thumbnail stands for: the theme's own, so the ground, the
 * line and its ends are the colours the detail map draws for that theme. The
 * line is the one subject colour, never the sport's.
 */
export function trackPreviewPalette(isDark: boolean): VectorMapPalette {
  return mapPalette(isDark ? 'dark' : 'light');
}

export const TrackPreview = memo(function TrackPreview({
  points,
  isDark,
  width = 48,
  height = 36,
  testID,
}: TrackPreviewProps) {
  if (points.length < 2) return null;

  const scaledPoints = fitTrackToBox(points, width, height, PADDING);
  const pointsString = scaledPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const palette = trackPreviewPalette(isDark);

  return (
    <Svg width={width} height={height} {...(testID !== undefined && { testID })}>
      <Rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill={palette.land}
        rx={layout.borderRadiusXs}
      />
      <Polyline
        points={pointsString}
        fill="none"
        stroke={palette.casing}
        strokeWidth={CASING_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points={pointsString}
        fill="none"
        stroke={palette.route}
        strokeWidth={LINE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <TrackEndpointMarkers
        start={scaledPoints[0]}
        end={scaledPoints[scaledPoints.length - 1]}
        startColor={palette.start}
        endColor={palette.ink}
        edgeColor={palette.casing}
      />
    </Svg>
  );
});

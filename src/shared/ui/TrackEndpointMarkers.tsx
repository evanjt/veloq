/**
 * The start and end of a track in an SVG thumbnail: a disc for the start and a
 * square for the end, so the two read apart without their colour, the way the
 * maps mark them with a triangle and a square.
 */

import React from 'react';
import { Circle, Rect } from 'react-native-svg';

import { stroke } from '@/theme';

interface Point {
  x: number;
  y: number;
}

/** Half the 6px a thumbnail's start and finish are drawn across. */
const MARKER_RADIUS = 3;

export function TrackEndpointMarkers({
  start,
  end,
  startColor,
  endColor,
  edgeColor,
}: {
  start: Point;
  end: Point;
  startColor: string;
  endColor: string;
  /** The ring around each marker, the line's casing, so it stands off the line. */
  edgeColor: string;
}) {
  return (
    <>
      <Circle
        cx={start.x}
        cy={start.y}
        r={MARKER_RADIUS}
        fill={startColor}
        stroke={edgeColor}
        strokeWidth={stroke.one}
      />
      <Rect
        x={end.x - MARKER_RADIUS}
        y={end.y - MARKER_RADIUS}
        width={MARKER_RADIUS * 2}
        height={MARKER_RADIUS * 2}
        fill={endColor}
        stroke={edgeColor}
        strokeWidth={stroke.one}
      />
    </>
  );
}

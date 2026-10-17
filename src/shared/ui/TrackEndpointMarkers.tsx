/**
 * The start and end of a track in an SVG thumbnail: a disc for the start and a
 * square for the end, so the two read apart without their colour, the way the
 * maps mark them with a triangle and a square.
 */

import React from 'react';
import { Circle, Rect } from 'react-native-svg';

import { colors, ink } from '@/theme';

interface Point {
  x: number;
  y: number;
}

const MARKER_RADIUS = 3;
const MARKER_STROKE = 1;

export function TrackEndpointMarkers({ start, end }: { start: Point; end: Point }) {
  return (
    <>
      <Circle
        cx={start.x}
        cy={start.y}
        r={MARKER_RADIUS}
        fill={colors.successFill}
        stroke={ink.white}
        strokeWidth={MARKER_STROKE}
      />
      <Rect
        x={end.x - MARKER_RADIUS}
        y={end.y - MARKER_RADIUS}
        width={MARKER_RADIUS * 2}
        height={MARKER_RADIUS * 2}
        fill={colors.dangerFill}
        stroke={ink.white}
        strokeWidth={MARKER_STROKE}
      />
    </>
  );
}

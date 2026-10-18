import React, { useMemo } from 'react';
import { Path, Skia } from '@shopify/react-native-skia';

import { areaFillsFromZero, areaWashOpacity } from './areaFill';
import type { Domain } from './cartesian';
import { LINE_CAP, LINE_JOIN, chartStroke } from './chartMarks';
import { curveAreaSvg, curveLineSvg, type CurveKind } from './curvePath';
import type { XY } from './svgPath';

interface CurveLineProps {
  points: readonly XY[];
  color: string;
  strokeWidth?: number;
  curve?: CurveKind;
  opacity?: number;
}

/**
 * A stroked curve through pixel points, inside a Skia canvas. It is a series
 * line at 2px unless told otherwise, and always joins and ends round.
 */
export function CurveLine({
  points,
  color,
  strokeWidth = chartStroke.series,
  curve = 'natural',
  opacity = 1,
}: CurveLineProps) {
  const path = useMemo(() => {
    const d = curveLineSvg(points, curve);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [points, curve]);
  if (!path) return null;
  return (
    <Path
      path={path}
      style="stroke"
      color={color}
      strokeWidth={strokeWidth}
      strokeJoin={LINE_JOIN}
      strokeCap={LINE_CAP}
      opacity={opacity}
    />
  );
}

interface CurveAreaProps {
  points: readonly XY[];
  /** The y domain the points were projected on. No area is drawn unless it starts at zero. */
  yDomain: Domain;
  /** Pixel y the area closes down to, the plot's zero. */
  y0: number;
  /** The line's colour, which the wash takes. */
  color: string;
  isDark: boolean;
  curve?: CurveKind;
}

/**
 * The flat wash between a curve and the zero baseline, inside a Skia canvas.
 * It draws nothing on a domain that does not start at zero, and the caller
 * draws the line over it.
 */
export function CurveArea({
  points,
  yDomain,
  y0,
  color,
  isDark,
  curve = 'natural',
}: CurveAreaProps) {
  const fills = areaFillsFromZero(yDomain);
  const path = useMemo(() => {
    if (!fills) return null;
    const d = curveAreaSvg(points, y0, curve);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [fills, points, y0, curve]);
  if (!path) return null;
  return <Path path={path} style="fill" color={color} opacity={areaWashOpacity(isDark)} />;
}

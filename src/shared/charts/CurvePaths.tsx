import React, { useMemo } from 'react';
import { Path, Skia } from '@shopify/react-native-skia';

import { curveAreaSvg, curveLineSvg, type CurveKind } from './curvePath';
import type { XY } from './svgPath';

interface CurveLineProps {
  points: readonly XY[];
  color: string;
  strokeWidth?: number;
  curve?: CurveKind;
  opacity?: number;
}

/** A stroked curve through pixel points, inside a Skia canvas. */
export function CurveLine({
  points,
  color,
  strokeWidth = 1,
  curve = 'natural',
  opacity,
}: CurveLineProps) {
  const path = useMemo(() => {
    const d = curveLineSvg(points, curve);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [points, curve]);
  if (!path) return null;
  return (
    <Path path={path} style="stroke" color={color} strokeWidth={strokeWidth} opacity={opacity} />
  );
}

interface CurveAreaProps {
  points: readonly XY[];
  /** Pixel y the area closes down to. */
  y0: number;
  curve?: CurveKind;
  color?: string;
  opacity?: number;
  /** A shader such as `LinearGradient`, painted instead of `color`. */
  children?: React.ReactNode;
}

/** The filled area between a curve and a horizontal baseline, inside a Skia canvas. */
export function CurveArea({
  points,
  y0,
  curve = 'natural',
  color,
  opacity,
  children,
}: CurveAreaProps) {
  const path = useMemo(() => {
    const d = curveAreaSvg(points, y0, curve);
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [points, y0, curve]);
  if (!path) return null;
  return (
    <Path path={path} style="fill" color={color} opacity={opacity}>
      {children}
    </Path>
  );
}

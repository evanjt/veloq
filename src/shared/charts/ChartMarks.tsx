import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas,
  Circle,
  Line as SkiaLine,
  PaintStyle,
  Path,
  RoundedRect,
  Skia,
  StrokeCap,
  StrokeJoin,
  vec,
  type SkCanvas,
  type SkPaint,
} from '@shopify/react-native-skia';

import {
  LINE_CAP,
  LINE_JOIN,
  RECORD_RING_RADIUS,
  barRadiusFor,
  chartStroke,
  dotDisks,
  reticleTicks,
  staircasePoints,
  TRIANGLE_SIZE,
  triangleSvg,
} from './chartMarks';
import { polylineSvgPath, type XY } from './svgPath';
import { useChartColors } from './useChartColors';

interface DotProps {
  x: number;
  y: number;
  color: string;
  opacity?: number;
}

/** An 8px dot in a 2px ring of the surface, inside a Skia canvas. */
export function ChartDot({ x, y, color, opacity = 1 }: DotProps) {
  const { surface } = useChartColors();
  const { ring, fill } = dotDisks();
  return (
    <>
      <Circle cx={x} cy={y} r={ring} color={surface} opacity={opacity} />
      <Circle cx={x} cy={y} r={fill} color={color} opacity={opacity} />
    </>
  );
}

interface ScrubDotProps {
  /** The scrubbed sample's point on this line, none when nothing is scrubbed or it has no value. */
  at: XY | null | undefined;
  color: string;
}

/** The dot every line draws at the scrubbed sample, nothing when no sample is scrubbed. */
export function ScrubDot({ at, color }: ScrubDotProps) {
  return at ? <ChartDot x={at.x} y={at.y} color={color} /> : null;
}

interface BarProps {
  /** The bar's centre. */
  x: number;
  /** Its two ends in pixels, in either order. */
  from: number;
  to: number;
  width: number;
  color: string;
  opacity?: number;
  /** A total still accruing, drawn in outline. */
  outline?: boolean;
}

/** One bar with rounded ends, its width from `barWidthFor`, inside a Skia canvas. */
export function ChartBar({ x, from, to, width, color, opacity = 1, outline = false }: BarProps) {
  const top = Math.min(from, to);
  const height = Math.abs(to - from);
  return (
    <RoundedRect
      x={x - width / 2}
      y={top}
      width={width}
      height={height}
      r={Math.min(barRadiusFor(width), height / 2)}
      color={color}
      opacity={opacity}
      {...(outline ? { style: 'stroke' as const, strokeWidth: chartStroke.ring } : {})}
    />
  );
}

/** The reticle: four short ink ticks round a point, which always means this activity. */
export function ReticleMark({ x, y }: XY) {
  const { ink } = useChartColors();
  return (
    <>
      {reticleTicks({ x, y }).map(({ from, to }, i) => (
        <SkiaLine
          key={i}
          p1={vec(from.x, from.y)}
          p2={vec(to.x, to.y)}
          color={ink}
          strokeWidth={chartStroke.ring}
          strokeCap={LINE_CAP}
        />
      ))}
    </>
  );
}

/** A gold ring round a point, which always means the record. */
export function RecordRing({ x, y }: XY) {
  const { achievement } = useChartColors();
  return (
    <Circle
      cx={x}
      cy={y}
      r={RECORD_RING_RADIUS}
      color={achievement}
      style="stroke"
      strokeWidth={chartStroke.ring}
    />
  );
}

interface StaircaseProps {
  /** Each record in the progression, oldest first. */
  steps: readonly XY[];
  /** Carries the newest record flat to this x. */
  rightEdge?: number;
}

/** The record's progression: a gold staircase with a gold dot at each record. */
export function RecordStaircase({ steps, rightEdge }: StaircaseProps) {
  const { achievement } = useChartColors();
  const path = useMemo(() => {
    const d = polylineSvgPath(staircasePoints(steps, rightEdge));
    return d ? Skia.Path.MakeFromSVGString(d) : null;
  }, [steps, rightEdge]);
  return (
    <>
      {path ? (
        <Path
          path={path}
          style="stroke"
          color={achievement}
          strokeWidth={chartStroke.series}
          strokeJoin={LINE_JOIN}
          strokeCap={LINE_CAP}
        />
      ) : null}
      {steps.map((step, i) => (
        <ChartDot key={i} x={step.x} y={step.y} color={achievement} />
      ))}
    </>
  );
}

/** The eFTP mark: an 8px triangle in a 2px ring of the surface. */
export function TriangleMark({ x, y, color }: DotProps) {
  const { surface } = useChartColors();
  const path = useMemo(() => Skia.Path.MakeFromSVGString(triangleSvg({ x, y })), [x, y]);
  if (!path) return null;
  return (
    <>
      <Path
        path={path}
        style="stroke"
        color={surface}
        strokeWidth={2 * chartStroke.ring}
        strokeJoin={LINE_JOIN}
      />
      <Path path={path} style="fill" color={color} />
    </>
  );
}

/**
 * The triangle mark as a key beside its legend words, in a canvas of its own
 * size. It sits on the card rather than over a line, so it takes no ring.
 */
export function TriangleKey({ color, testID }: { color: string; testID?: string }) {
  const path = useMemo(
    () => Skia.Path.MakeFromSVGString(triangleSvg({ x: TRIANGLE_SIZE / 2, y: TRIANGLE_SIZE / 2 })),
    []
  );
  return (
    <Canvas style={styles.triangleKey} testID={testID}>
      {path ? <Path path={path} style="fill" color={color} /> : null}
    </Canvas>
  );
}

/**
 * A paint for a line recorded into a picture, at a series width unless told
 * otherwise, joined and capped round as `CurveLine` draws.
 */
export function chartLinePaint(color: string, width: number = chartStroke.series): SkPaint {
  const paint = Skia.Paint();
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  return paint;
}

/** `ChartDot` recorded into a picture: the surface ring, then the fill. */
export function drawChartDot(canvas: SkCanvas, at: XY, color: string, surface: string): void {
  const { ring, fill } = dotDisks();
  const paint = Skia.Paint();
  paint.setStyle(PaintStyle.Fill);
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(surface));
  canvas.drawCircle(at.x, at.y, ring, paint);
  paint.setColor(Skia.Color(color));
  canvas.drawCircle(at.x, at.y, fill, paint);
}

const styles = StyleSheet.create({
  triangleKey: {
    width: TRIANGLE_SIZE,
    height: TRIANGLE_SIZE,
  },
});

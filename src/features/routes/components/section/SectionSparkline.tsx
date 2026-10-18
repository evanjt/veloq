/**
 * Minimal sparkline for section performance - just dots and a trend line.
 * Purpose-built for compact inline use (no axes, labels, or gestures).
 */

import React from 'react';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import {
  ChartDot,
  chartStroke,
  LINE_CAP,
  LINE_JOIN,
  polylineSvgPath,
  useChartColors,
} from '@/shared/charts';
import { colors, colorWithOpacity, ink } from '@/theme';
import type { PerformanceDataPoint } from '@/types';

interface SectionSparklineProps {
  data: (PerformanceDataPoint & { x: number })[];
  width: number;
  height: number;
  isDark: boolean;
  highlightActivityId?: string;
}

export const SectionSparkline = React.memo(function SectionSparkline({
  data,
  width,
  height,
  isDark,
  highlightActivityId,
}: SectionSparklineProps) {
  // This attempt is marked in ink, the colour of the mark for this activity.
  const { ink: inkColor } = useChartColors();
  if (data.length < 2 || width <= 0 || height <= 0) return null;

  const pad = { x: 6, y: 6 };
  const w = width - pad.x * 2;
  const h = height - pad.y * 2;

  const speeds = data.map((d) => d.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const range = maxSpeed - minSpeed || 1;

  const toX = (i: number) => pad.x + (i / (data.length - 1)) * w;
  const toY = (speed: number) => pad.y + ((maxSpeed - speed) / range) * h;

  // Build trend line path
  const trendPath = Skia.Path.MakeFromSVGString(
    polylineSvgPath(data.map((d, i) => ({ x: toX(i), y: toY(d.speed) })))
  );

  const dotColor = isDark
    ? colorWithOpacity(colors.textOnFill, 0.6)
    : colorWithOpacity(ink.black, 0.35);
  const lineColor = isDark
    ? colorWithOpacity(colors.textOnFill, 0.35)
    : colorWithOpacity(ink.black, 0.15);

  return (
    <Canvas style={{ width, height }}>
      {/* Trend line */}
      {trendPath ? (
        <Path
          path={trendPath}
          color={lineColor}
          style="stroke"
          strokeWidth={chartStroke.series}
          strokeJoin={LINE_JOIN}
          strokeCap={LINE_CAP}
        />
      ) : null}

      {/* Data points */}
      {data.map((point, i) => {
        const isHighlight = point.activityId === highlightActivityId;

        if (isHighlight) {
          return <ChartDot key={i} x={toX(i)} y={toY(point.speed)} color={inkColor} />;
        }

        return <Circle key={i} cx={toX(i)} cy={toY(point.speed)} r={2} color={dotColor} />;
      })}
    </Canvas>
  );
});

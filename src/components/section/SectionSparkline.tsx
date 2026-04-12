/**
 * Minimal sparkline for section performance — just dots and a trend line.
 * Purpose-built for compact inline use (no axes, labels, or gestures).
 */

import React from 'react';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { colors } from '@/theme';
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
  const trendPath = Skia.Path.Make();
  trendPath.moveTo(toX(0), toY(data[0].speed));
  for (let i = 1; i < data.length; i++) {
    trendPath.lineTo(toX(i), toY(data[i].speed));
  }

  const dotColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
  const lineColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';

  return (
    <Canvas style={{ width, height }}>
      {/* Trend line */}
      <Path path={trendPath} color={lineColor} style="stroke" strokeWidth={1.5} />

      {/* Data points */}
      {data.map((point, i) => {
        const isHighlight = point.activityId === highlightActivityId;

        if (isHighlight) {
          return (
            <React.Fragment key={i}>
              <Circle
                cx={toX(i)}
                cy={toY(point.speed)}
                r={5}
                color={colors.primary}
                style="stroke"
                strokeWidth={1.5}
              />
              <Circle cx={toX(i)} cy={toY(point.speed)} r={3} color={colors.primary} />
            </React.Fragment>
          );
        }

        return <Circle key={i} cx={toX(i)} cy={toY(point.speed)} r={2} color={dotColor} />;
      })}
    </Canvas>
  );
});

import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Circle, LinearGradient, vec } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';

interface DataPoint {
  date: Date;
  time: number; // seconds (lower = faster = better)
}

interface MiniPerformanceSparklineProps {
  data: DataPoint[];
  bestIndex?: number;
  height?: number;
  color?: string;
}

export const MiniPerformanceSparkline = React.memo(function MiniPerformanceSparkline({
  data,
  bestIndex,
  height = 100,
  color = '#FC4C02',
}: MiniPerformanceSparklineProps) {
  const { isDark } = useTheme();

  const { linePath, areaPath, dots, bestDot } = useMemo(() => {
    if (data.length < 2) {
      return { linePath: '', areaPath: '', dots: [], bestDot: null };
    }

    const WIDTH = 280;
    const PADDING_X = 12;
    const PADDING_Y = 12;
    const drawW = WIDTH - PADDING_X * 2;
    const drawH = height - PADDING_Y * 2;

    // Y-axis inverted: lower time = better = higher on chart
    const times = data.map((d) => d.time);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const range = maxTime - minTime || 1;

    const points = data.map((d, i) => ({
      x: PADDING_X + (i / (data.length - 1)) * drawW,
      // Invert: fastest (min) at top, slowest (max) at bottom
      y: PADDING_Y + ((d.time - minTime) / range) * drawH,
    }));

    // Build line path
    let line = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      line += ` L ${points[i].x} ${points[i].y}`;
    }

    // Build area path (fill under line)
    const lastX = points[points.length - 1].x;
    const area = `${line} L ${lastX} ${height} L ${points[0].x} ${height} Z`;

    // Dot positions
    const dotPositions = points.map((p, i) => ({
      x: p.x,
      y: p.y,
      isBest: i === bestIndex,
    }));

    const best = bestIndex != null && bestIndex < points.length ? points[bestIndex] : null;

    return { linePath: line, areaPath: area, dots: dotPositions, bestDot: best };
  }, [data, bestIndex, height]);

  if (data.length < 2 || !linePath) return null;

  const dotColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)';

  return (
    <View style={{ height }}>
      <Canvas style={{ width: 280, height }}>
        {/* Gradient area fill */}
        <Path path={areaPath} style="fill">
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[`${color}30`, `${color}05`]}
          />
        </Path>

        {/* Main line */}
        <Path path={linePath} style="stroke" strokeWidth={2} color={color} />

        {/* Scatter dots */}
        {dots.map((dot, i) =>
          dot.isBest ? null : <Circle key={i} cx={dot.x} cy={dot.y} r={3} color={dotColor} />
        )}

        {/* Best record dot — highlighted */}
        {bestDot ? (
          <>
            <Circle cx={bestDot.x} cy={bestDot.y} r={6} color={`${color}30`} />
            <Circle cx={bestDot.x} cy={bestDot.y} r={4} color={color} />
          </>
        ) : null}
      </Canvas>
    </View>
  );
});

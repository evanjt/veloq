/**
 * What a route is, drawn on fixed demo data: several activities over the same course laid on one
 * another, and each attempt's time beside the others with the best marked.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Path, Rect } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, colorWithOpacity } from '@/theme';
import { tourPanelColour } from './tourPanel';

const MAP_SIZE = 96;
const BARS_WIDTH = 120;
const PAD = 10;
const FAINT_OPACITY = 0.35;

/** Each demo activity's offset from the course, in pixels, so the traces sit side by side. */
const TRACE_OFFSETS = [-2.5, -1, 0.5, 2, 3];

/** Each demo attempt's time over the route in minutes, oldest first. */
const ROUTE_TIMES = [48.5, 47.2, 47.9, 46.1, 45.4, 46.6];

function loopPath(offset: number): string {
  const steps = 40;
  const centre = MAP_SIZE / 2;
  const radius = MAP_SIZE / 2 - PAD + offset;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;
    // A rounded, slightly uneven loop, as a real course is.
    const r = radius * (1 + 0.12 * Math.sin(angle * 3));
    const x = centre + r * Math.cos(angle);
    const y = centre + r * 0.8 * Math.sin(angle);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
}

export function RoutesSlide() {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const background = tourPanelColour(isDark);

  const picture = useMemo(() => {
    const best = Math.min(...ROUTE_TIMES);
    const slowest = Math.max(...ROUTE_TIMES);
    const barSpace = (BARS_WIDTH - PAD * 2) / ROUTE_TIMES.length;
    const usable = MAP_SIZE - PAD * 2;
    return {
      traces: TRACE_OFFSETS.map(loopPath),
      bars: ROUTE_TIMES.map((minutes, i) => {
        // Faster is taller, with the slowest still drawn.
        const height = usable * (0.35 + (0.65 * (slowest - minutes)) / (slowest - best));
        return {
          x: PAD + i * barSpace + 2,
          y: MAP_SIZE - PAD - height,
          width: barSpace - 4,
          height,
          best: minutes === best,
        };
      }),
    };
  }, []);

  return (
    <View style={styles.row} testID="tour-routes-picture">
      <View style={[styles.panel, { backgroundColor: background }]}>
        <Canvas style={{ width: MAP_SIZE, height: MAP_SIZE }}>
          {picture.traces.map((trace, i) => (
            <Path
              key={i}
              path={trace}
              style="stroke"
              strokeWidth={1.5}
              strokeJoin="round"
              color={colorWithOpacity(palette.primary, FAINT_OPACITY)}
            />
          ))}
        </Canvas>
      </View>
      <View style={[styles.panel, { backgroundColor: background }]}>
        <Canvas style={{ width: BARS_WIDTH, height: MAP_SIZE }}>
          {picture.bars.map((bar, i) => (
            <Rect
              key={i}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              color={bar.best ? palette.primary : colorWithOpacity(palette.primary, FAINT_OPACITY)}
            />
          ))}
        </Canvas>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  panel: {
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
});

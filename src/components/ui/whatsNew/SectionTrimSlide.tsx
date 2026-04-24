import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Canvas,
  Path,
  Circle,
  Line,
  vec,
  RoundedRect,
  DashPathEffect,
} from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 80;
const PAD_X = 20;
const PAD_Y = 16;
const DRAW_W = CANVAS_WIDTH - PAD_X * 2;
const DRAW_H = CANVAS_HEIGHT - PAD_Y * 2;

// Simulated elevation profile (extended to show expand context)
const ELEVATION = [
  8, 10, 12, 14, 20, 30, 38, 42, 40, 35, 28, 22, 18, 20, 26, 34, 40, 36, 28, 20, 14, 10, 8, 6,
];

// Original auto-detected boundaries (narrower)
const ORIGINAL_START = 0.25;
const ORIGINAL_END = 0.7;

// Expanded handles (user extended beyond auto-detected)
const EXPAND_START = 0.12;
const EXPAND_END = 0.85;

function buildPath(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = PAD_X + (i / (values.length - 1)) * DRAW_W;
      const y = PAD_Y + DRAW_H - ((v - min) / range) * DRAW_H;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

export function SectionTrimSlide() {
  const { isDark } = useTheme();
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const dimColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
  const originalMarkerColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.20)';
  const handleColor = primaryColor;

  const path = buildPath(ELEVATION);
  const origStartX = PAD_X + ORIGINAL_START * DRAW_W;
  const origEndX = PAD_X + ORIGINAL_END * DRAW_W;
  const expandStartX = PAD_X + EXPAND_START * DRAW_W;
  const expandEndX = PAD_X + EXPAND_END * DRAW_W;
  const handleR = 6;

  return (
    <View style={styles.container}>
      <Canvas style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
        {/* Dimmed zones outside expanded range */}
        <RoundedRect
          x={0}
          y={0}
          width={expandStartX}
          height={CANVAS_HEIGHT}
          r={0}
          color={dimColor}
        />
        <RoundedRect
          x={expandEndX}
          y={0}
          width={CANVAS_WIDTH - expandEndX}
          height={CANVAS_HEIGHT}
          r={0}
          color={dimColor}
        />

        {/* Elevation path */}
        <Path
          path={path}
          color={primaryColor}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
        />

        {/* Original auto-detected boundary markers (dashed) */}
        <Line
          p1={vec(origStartX, PAD_Y - 2)}
          p2={vec(origStartX, CANVAS_HEIGHT - PAD_Y + 2)}
          color={originalMarkerColor}
          strokeWidth={1.5}
        >
          <DashPathEffect intervals={[3, 3]} />
        </Line>
        <Line
          p1={vec(origEndX, PAD_Y - 2)}
          p2={vec(origEndX, CANVAS_HEIGHT - PAD_Y + 2)}
          color={originalMarkerColor}
          strokeWidth={1.5}
        >
          <DashPathEffect intervals={[3, 3]} />
        </Line>

        {/* Expanded handle lines */}
        <Line
          p1={vec(expandStartX, PAD_Y - 4)}
          p2={vec(expandStartX, CANVAS_HEIGHT - PAD_Y + 4)}
          color={handleColor}
          strokeWidth={2}
        />
        <Line
          p1={vec(expandEndX, PAD_Y - 4)}
          p2={vec(expandEndX, CANVAS_HEIGHT - PAD_Y + 4)}
          color={handleColor}
          strokeWidth={2}
        />

        {/* Handle circles */}
        <Circle cx={expandStartX} cy={CANVAS_HEIGHT / 2} r={handleR} color={handleColor} />
        <Circle
          cx={expandStartX}
          cy={CANVAS_HEIGHT / 2}
          r={handleR - 2}
          color={isDark ? darkColors.surface : colors.surface}
        />
        <Circle cx={expandEndX} cy={CANVAS_HEIGHT / 2} r={handleR} color={handleColor} />
        <Circle
          cx={expandEndX}
          cy={CANVAS_HEIGHT / 2}
          r={handleR - 2}
          color={isDark ? darkColors.surface : colors.surface}
        />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
});

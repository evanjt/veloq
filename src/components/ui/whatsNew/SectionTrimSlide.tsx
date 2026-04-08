import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Path, Circle, Line, vec, RoundedRect } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 80;
const PAD_X = 20;
const PAD_Y = 16;
const DRAW_W = CANVAS_WIDTH - PAD_X * 2;
const DRAW_H = CANVAS_HEIGHT - PAD_Y * 2;

// Simulated elevation profile
const ELEVATION = [10, 14, 20, 30, 38, 42, 40, 35, 28, 22, 18, 20, 26, 34, 40, 36, 28, 20, 14, 10];

// Trim handles at 25% and 75%
const TRIM_START = 0.25;
const TRIM_END = 0.75;

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
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const dimColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
  const handleColor = primaryColor;

  const path = buildPath(ELEVATION);
  const startX = PAD_X + TRIM_START * DRAW_W;
  const endX = PAD_X + TRIM_END * DRAW_W;
  const handleR = 6;

  return (
    <View style={styles.container}>
      <Canvas style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
        {/* Dimmed zones outside trim range */}
        <RoundedRect x={0} y={0} width={startX} height={CANVAS_HEIGHT} r={0} color={dimColor} />
        <RoundedRect
          x={endX}
          y={0}
          width={CANVAS_WIDTH - endX}
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

        {/* Trim handle lines */}
        <Line
          p1={vec(startX, PAD_Y - 4)}
          p2={vec(startX, CANVAS_HEIGHT - PAD_Y + 4)}
          color={handleColor}
          strokeWidth={2}
        />
        <Line
          p1={vec(endX, PAD_Y - 4)}
          p2={vec(endX, CANVAS_HEIGHT - PAD_Y + 4)}
          color={handleColor}
          strokeWidth={2}
        />

        {/* Handle circles */}
        <Circle cx={startX} cy={CANVAS_HEIGHT / 2} r={handleR} color={handleColor} />
        <Circle
          cx={startX}
          cy={CANVAS_HEIGHT / 2}
          r={handleR - 2}
          color={isDark ? darkColors.surface : colors.surface}
        />
        <Circle cx={endX} cy={CANVAS_HEIGHT / 2} r={handleR} color={handleColor} />
        <Circle
          cx={endX}
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

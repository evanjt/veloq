import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const MUSCLE_GROUPS = [
  { label: 'Chest', left: 0.7, right: 0.65 },
  { label: 'Back', left: 0.85, right: 0.8 },
  { label: 'Shoulders', left: 0.5, right: 0.55 },
  { label: 'Legs', left: 0.9, right: 0.75 },
];

const BAR_WIDTH = 80;
const BAR_HEIGHT = 10;
const ROW_HEIGHT = 28;
const GAP = 6;
const CANVAS_WIDTH = BAR_WIDTH * 2 + GAP;
const CANVAS_HEIGHT = MUSCLE_GROUPS.length * ROW_HEIGHT;

const LEFT_COLOR = '#8B5CF6';
const RIGHT_COLOR = '#06B6D4';

export function StrengthSlide() {
  const { isDark } = useTheme();
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={styles.container}>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: LEFT_COLOR }]} />
          <Text style={[styles.legendText, { color: mutedColor }]}>This week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: RIGHT_COLOR }]} />
          <Text style={[styles.legendText, { color: mutedColor }]}>Last week</Text>
        </View>
      </View>
      <View style={styles.chartRow}>
        <View style={styles.labels}>
          {MUSCLE_GROUPS.map((g) => (
            <Text key={g.label} style={[styles.label, { color: mutedColor, height: ROW_HEIGHT }]}>
              {g.label}
            </Text>
          ))}
        </View>
        <Canvas style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
          {MUSCLE_GROUPS.map((g, i) => {
            const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
            return (
              <React.Fragment key={g.label}>
                {/* Track backgrounds */}
                <RoundedRect
                  x={0}
                  y={y}
                  width={BAR_WIDTH}
                  height={BAR_HEIGHT}
                  r={3}
                  color={trackColor}
                />
                <RoundedRect
                  x={BAR_WIDTH + GAP}
                  y={y}
                  width={BAR_WIDTH}
                  height={BAR_HEIGHT}
                  r={3}
                  color={trackColor}
                />
                {/* Filled bars */}
                <RoundedRect
                  x={0}
                  y={y}
                  width={BAR_WIDTH * g.left}
                  height={BAR_HEIGHT}
                  r={3}
                  color={LEFT_COLOR}
                />
                <RoundedRect
                  x={BAR_WIDTH + GAP}
                  y={y}
                  width={BAR_WIDTH * g.right}
                  height={BAR_HEIGHT}
                  r={3}
                  color={RIGHT_COLOR}
                />
              </React.Fragment>
            );
          })}
        </Canvas>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '500',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  labels: {
    width: 70,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    textAlignVertical: 'center',
    lineHeight: ROW_HEIGHT,
  },
});

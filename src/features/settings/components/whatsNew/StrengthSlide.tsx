import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography } from '@/theme';

// Illustrative values. The four groups are the coarse ones the body diagram
// rolls its fifteen muscle slugs up into, so `MUSCLE_DISPLAY_NAMES` has no key
// for them and they carry their own.
const MUSCLE_GROUPS = [
  { key: 'whatsNew.v030.strengthChest', left: 0.7, right: 0.65 },
  { key: 'whatsNew.v030.strengthBack', left: 0.85, right: 0.8 },
  { key: 'whatsNew.v030.strengthShoulders', left: 0.5, right: 0.55 },
  { key: 'whatsNew.v030.strengthLegs', left: 0.9, right: 0.75 },
];

const BAR_WIDTH = 80;
const BAR_HEIGHT = 10;
const ROW_HEIGHT = 28;
const GAP = 6;
const CANVAS_WIDTH = BAR_WIDTH * 2 + GAP;
const CANVAS_HEIGHT = MUSCLE_GROUPS.length * ROW_HEIGHT;

const LEFT_COLOR = colors.walk;
const RIGHT_COLOR = colors.swim;

export function StrengthSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={styles.container}>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: LEFT_COLOR }]} />
          <Text style={[styles.legendText, { color: mutedColor }]}>
            {t('whatsNew.v030.strengthThisWeek')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: RIGHT_COLOR }]} />
          <Text style={[styles.legendText, { color: mutedColor }]}>
            {t('whatsNew.v030.strengthLastWeek')}
          </Text>
        </View>
      </View>
      <View style={styles.chartRow}>
        <View style={styles.labels}>
          {MUSCLE_GROUPS.map((g) => (
            <Text key={g.key} style={[styles.label, { color: mutedColor, height: ROW_HEIGHT }]}>
              {t(g.key as ParseKeys)}
            </Text>
          ))}
        </View>
        <Canvas style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
          {MUSCLE_GROUPS.map((g, i) => {
            const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
            return (
              <React.Fragment key={g.key}>
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
    borderRadius: layout.borderRadiusFull,
  },
  legendText: {
    fontSize: typography.label.fontSize,
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
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    textAlignVertical: 'center',
    lineHeight: ROW_HEIGHT,
  },
});

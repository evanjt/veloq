import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { describeWeekShape } from '../lib/weekShape';

/** The engine's reading for a window, or `null` when it withheld one. */
export interface WeekShape {
  /** One entry per day of the window, gaps included as zero. */
  daily: number[];
  /** Days carrying any load at all. */
  trainingDays: number;
  /** Mean daily load over its standard deviation. Never rendered. */
  evenness: number;
}

interface WeekShapeCardProps {
  shape: WeekShape | null;
}

/**
 * Written out rather than built from the reading, so each key appears in the
 * source as a literal and the unused-key check can see all three.
 */
const READING_KEY = {
  lopsided: 'fitness.weekShape.reading.lopsided',
  mixed: 'fitness.weekShape.reading.mixed',
  even: 'fitness.weekShape.reading.even',
} as const;

/** Shortest bar a day with load still gets, so one hard day does not erase five easy ones. */
const MIN_DRAWN_HEIGHT = 0.08;

/**
 * What shape the week had: a row of daily bars and one sentence.
 *
 * The engine's number is mean daily load over its standard deviation, which
 * means nothing to an athlete, so it is never shown. What the athlete reads is
 * the shape and a sentence naming it.
 *
 * The engine withholds the reading below four training days, because the ratio
 * is a constant on a sparser week. Half of a real account's weeks fall under
 * that floor, so the absent case is the common one and is written as an
 * ordinary thing a week can be, not as an error and not as a zero.
 */
export const WeekShapeCard = React.memo(function WeekShapeCard({ shape }: WeekShapeCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  if (!shape) {
    return (
      <View testID="week-shape-quiet" style={[styles.card, { backgroundColor: palette.surface }]}>
        <Text style={[styles.title, { color: palette.textSecondary }]}>
          {t('fitness.weekShape.title')}
        </Text>
        <Text style={[styles.quiet, { color: palette.textSecondary }]}>
          {t('fitness.weekShape.quiet')}
        </Text>
      </View>
    );
  }

  const peak = Math.max(...shape.daily, 0);

  return (
    <View testID="week-shape-card" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Text style={[styles.title, { color: palette.textSecondary }]}>
        {t('fitness.weekShape.title')}
      </Text>

      <View style={styles.bars}>
        {shape.daily.map((load, day) => (
          <View
            key={day}
            testID={`week-shape-bar-${day}`}
            accessibilityValue={{ now: load, min: 0, max: peak }}
            style={[
              styles.bar,
              {
                backgroundColor: load > 0 ? palette.primary : palette.border,
                flexGrow: load > 0 && peak > 0 ? Math.max(load / peak, MIN_DRAWN_HEIGHT) : 0,
                height: load > 0 && peak > 0 ? undefined : 2,
              },
            ]}
          />
        ))}
      </View>

      <Text testID="week-shape-reading" style={[styles.reading, { color: palette.textPrimary }]}>
        {t(READING_KEY[describeWeekShape(shape.evenness)], { days: shape.trainingDays })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.caption,
    textTransform: 'uppercase',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    height: 48,
  },
  bar: {
    flex: 1,
    borderRadius: layout.borderRadiusXs,
  },
  reading: {
    ...typography.body,
  },
  quiet: {
    ...typography.body,
  },
});

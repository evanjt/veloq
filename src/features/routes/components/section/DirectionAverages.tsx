/**
 * One line under a card's stats row: the average of each direction in the basis the chart plots,
 * forward first, each with its direction cue. A direction with no laps draws nothing, and with
 * neither the line is left out.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import { FitText } from '@/shared/ui/FitText';
import { formatAttemptFigure, type AttemptBasis } from '@/features/routes/lib/attemptBasis';
import { directionColour } from '@/features/routes/lib/directionColour';
import { iconSize, spacing, themePalette, typography } from '@/theme';
import type { DirectionStats } from '@/types';
import { DirectionArrow, directionWord, type SectionDirection } from './DirectionCue';

interface DirectionAveragesProps {
  forwardStats: DirectionStats | null | undefined;
  reverseStats: DirectionStats | null | undefined;
  /** What the average reads as, the basis the chart plots on. */
  basis: AttemptBasis;
}

export function DirectionAverages({ forwardStats, reverseStats, basis }: DirectionAveragesProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);

  const entries = (
    [
      ['forward', forwardStats],
      ['reverse', reverseStats],
    ] as const
  ).flatMap(([direction, stats]) =>
    stats && stats.avgTime != null
      ? [
          {
            direction: direction as SectionDirection,
            value: formatAttemptFigure(basis, stats.avgTime, stats.avgPaceText, isMetric),
          },
        ]
      : []
  );
  if (entries.length === 0) return null;

  return (
    <View testID="section-direction-averages" style={styles.line}>
      {entries.map(({ direction, value }) => (
        <View key={direction} style={styles.entry}>
          <View testID={`section-avg-${direction}-cue`} style={styles.cue}>
            <DirectionArrow
              direction={direction}
              color={directionColour(direction, isDark)}
              size={iconSize.xs}
            />
            <FitText style={[styles.word, { color: palette.textSecondary }]}>
              {`${t('sections.avg', 'Avg')} · ${directionWord(t, direction)}`}
            </FitText>
          </View>
          <FitText
            testID={`section-avg-${direction}`}
            style={[styles.value, { color: palette.textPrimary }]}
          >
            {value}
          </FitText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.md,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  word: {
    ...typography.caption,
  },
  value: {
    ...typography.bodyBold,
  },
});

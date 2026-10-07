import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useActivityLabels } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { Button, EngineReadFailure } from '@/shared/ui';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { formatClimbValue } from '../lib/bestEfforts';
import { SPORT_TEXT_COLORS, SPORT_TEXT_COLORS_DARK, type PrimarySport } from '../stores';
import { colors, darkColors, spacing, typography, colorWithOpacity, ink } from '@/theme';
import type { ClimbBest } from '@/features/stats';

interface ClimbingBestRowsProps {
  bests: ClimbBest[];
  sport: PrimarySport;
}

/** One climbing best per window: vertical power for the short ones, climbing rate for the long. */
export function ClimbingBestRows({ bests, sport }: ClimbingBestRowsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK[sport] : SPORT_TEXT_COLORS[sport];
  const units = {
    wattsPerKg: t('units.wattsPerKg'),
    metresPerHour: t('units.metresPerHour'),
    feetPerHour: t('units.feetPerHour'),
  };

  const ids = useMemo(
    () => bests.map((b) => b.activityId).filter((id): id is string => !!id),
    [bests]
  );
  const { labels, error } = useActivityLabels(ids);

  return (
    <View>
      {error != null && (
        <EngineReadFailure error={error} testID={`climbing-labels-failed-${sport}`} />
      )}
      {bests.map((best, index) => {
        const name = best.activityId ? labels.get(best.activityId)?.name : undefined;
        const isLast = index === bests.length - 1;
        return (
          <View
            key={best.windowS}
            testID={`season-bests-climbing-${best.windowS}`}
            style={[
              styles.row,
              !isLast && styles.rowBorder,
              !isLast && isDark && styles.rowBorderDark,
            ]}
          >
            <Text style={[styles.label, isDark && styles.labelDark]}>{best.label}</Text>
            <View style={styles.valueColumn}>
              <Text style={[styles.value, { color: sportText }]}>
                {formatClimbValue(best, isMetric, units)}
              </Text>
            </View>
            <View style={styles.activityColumn}>
              {name && best.activityId ? (
                <Button
                  label={`${name} →`}
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push(`/activity/${best.activityId}`)}
                  style={styles.activityLink}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorWithOpacity(ink.black, 0.08),
  },
  rowBorderDark: {
    borderBottomColor: colorWithOpacity(ink.white, 0.08),
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 48,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  valueColumn: {
    width: 100,
    alignItems: 'flex-end',
  },
  value: {
    ...typography.body,
    fontWeight: '700',
  },
  activityColumn: {
    flex: 1,
    marginLeft: spacing.md,
  },
  activityLink: {
    alignSelf: 'flex-start',
  },
});

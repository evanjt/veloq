import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Button, CardHeader, EmptyState } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';
import { useTranslation } from 'react-i18next';
import { formatRelativeDate } from '@/shared/format/format';
import { colors, darkColors, typography, spacing } from '@/theme';
import type { DecouplingSource } from '@/features/activity';
import { tapTo } from '@/shared/app/navigation';
import { formatPercent } from '@/shared/format';

interface DecouplingChartProps {
  /** The ride and the decoupling intervals.icu stored for it, null when none has one */
  source: DecouplingSource | null;
  /** Height of the empty state */
  height?: number | undefined;
  /**
   * The census answer for the period the ride is picked from. `NotFetched`
   * turns the empty state into "not downloaded". Absent, the chart claims
   * nothing either way.
   */
  coverage?: RangeCoverage | undefined;
}

/**
 * The stored decoupling of one ride, with the ride named so the figure can be
 * found again on its activity screen. It states the measurement and grades
 * nothing.
 */
export function DecouplingChart({ source, height = 150, coverage }: DecouplingChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (!source) {
    return (
      <View style={styles.container}>
        <CardHeader title={t('stats.aerobicDecoupling')} />
        <View style={[styles.emptyState, { height }]}>
          {coverage === RangeCoverage.NotFetched ? (
            <EmptyState
              variant="inline"
              testID="decoupling-not-downloaded"
              title={t('stats.rangeNotDownloaded')}
            />
          ) : (
            <EmptyState
              variant="inline"
              title={t('stats.noDecouplingData')}
              description={t('stats.completeDecouplingHint')}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CardHeader
        title={t('stats.aerobicDecoupling')}
        accessory={
          <Text style={[styles.decouplingValue, isDark && styles.textLight]}>
            {formatPercent(source.decoupling, 1)}
          </Text>
        }
      />

      <Button
        testID="decoupling-source"
        variant="ghost"
        size="sm"
        label={`${source.name} · ${formatRelativeDate(source.date)}`}
        onPress={() => tapTo(`/activity/${source.activityId}`)}
        style={styles.sourceRide}
      />
      <Text style={[styles.provenance, isDark && styles.textDark]}>
        {t('stats.decouplingProvenance')}
      </Text>

      <Text style={[styles.explanation, isDark && styles.textDark]}>
        {t('stats.decouplingExplanation')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  decouplingValue: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sourceRide: {
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
  },
  provenance: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  explanation: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

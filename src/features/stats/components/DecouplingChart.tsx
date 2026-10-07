import React from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatRelativeDate } from '@/shared/format/format';
import { colors, darkColors, typography, spacing } from '@/theme';
import type { DecouplingSource } from '@/features/activity';

interface DecouplingChartProps {
  /** The ride and the decoupling intervals.icu stored for it, null when none has one */
  source: DecouplingSource | null;
  /** Height of the empty state */
  height?: number | undefined;
}

/**
 * The stored decoupling of one ride, with the ride named so the figure can be
 * found again on its activity screen. It states the measurement and grades
 * nothing.
 */
export function DecouplingChart({ source, height = 150 }: DecouplingChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (!source) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.aerobicDecoupling')}
          </Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noDecouplingData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {t('stats.completeDecouplingHint')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.aerobicDecoupling')}
        </Text>
        <Text style={[styles.decouplingValue, isDark && styles.textLight]}>
          {source.decoupling.toFixed(1)}%
        </Text>
      </View>

      <Button
        testID="decoupling-source"
        variant="ghost"
        size="sm"
        label={`${source.name} · ${formatRelativeDate(source.date)}`}
        onPress={() => router.push(`/activity/${source.activityId}`)}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
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
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});

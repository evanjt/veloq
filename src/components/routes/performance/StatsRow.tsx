import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatRelativeDate } from '@/lib';
import { colors, opacity, spacing, typography } from '@/theme';

interface StatsRowProps {
  currentSpeed: number | null;
  bestSpeed: number | null;
  bestDate: Date | null;
  formatSpeedValue: (speed: number) => string;
  showPace: boolean;
  isTooltipActive: boolean;
  isDark: boolean;
  currentActivityColor: string;
}

export function StatsRow({
  currentSpeed,
  bestSpeed,
  bestDate,
  formatSpeedValue,
  showPace,
  isTooltipActive,
  isDark,
  currentActivityColor,
}: StatsRowProps) {
  const { t } = useTranslation();

  return (
    <View style={[styles.statsRow, isDark && styles.statsRowDark]}>
      <View style={styles.stat}>
        <Text style={[styles.statValue, { color: currentActivityColor }]}>
          {currentSpeed !== null ? formatSpeedValue(currentSpeed) : '-'}
        </Text>
        <Text style={[styles.statLabel, isDark && styles.textMuted]}>
          {isTooltipActive
            ? t('routes.selected')
            : showPace
              ? t('routes.thisPace')
              : t('routes.thisSpeed')}
        </Text>
      </View>
      <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
      <View style={styles.stat}>
        <Text style={[styles.statValue, { color: '#FFB300' }]}>
          {bestSpeed !== null ? formatSpeedValue(bestSpeed) : '-'}
        </Text>
        <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('routes.best')}</Text>
      </View>
      <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
      <View style={styles.stat}>
        <Text style={[styles.statValue, isDark && styles.textLight]}>
          {bestDate ? formatRelativeDate(bestDate.toISOString()) : '-'}
        </Text>
        <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('routes.bestOn')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
    paddingVertical: spacing.md,
  },
  statsRowDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: opacity.overlay.medium,
  },
  statDividerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: '#888',
  },
});

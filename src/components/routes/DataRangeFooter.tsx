/**
 * DataRangeFooter - Discreet footer showing data range with link to expand
 *
 * Shows at the bottom of route/section screens to inform users about
 * the date range of cached data and how to expand it.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography } from '@/theme';

interface DataRangeFooterProps {
  /** Number of days of data being shown */
  days: number;
  isDark?: boolean;
}

export function DataRangeFooter({ days, isDark = false }: DataRangeFooterProps) {
  const { t } = useTranslation();

  const handleExpandPress = () => {
    router.push('/settings?scrollTo=cache');
  };

  // Format days as human readable (e.g., "3 years", "90 days")
  const formatDuration = (d: number): string => {
    if (d >= 365) {
      const years = Math.round(d / 365);
      return t('time.yearsCount', { count: years });
    }
    return t('time.daysCount', { count: d });
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Text style={[styles.text, isDark && styles.textMuted]}>
        {t('routes.dataRangeHint', { duration: formatDuration(days) })}
      </Text>
      <Pressable style={styles.button} onPress={handleExpandPress} hitSlop={8}>
        <Text style={styles.buttonText}>{t('routes.expandInSettings')}</Text>
        <MaterialCommunityIcons name="chevron-right" size={14} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  containerDark: {},
  text: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  buttonText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
  },
});

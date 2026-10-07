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
import { pressable, pressRipple } from '@/shared/ui';
import { formatDaySpan, type SpanTranslator } from '@/shared/format';

interface DataRangeFooterProps {
  /** Number of days of data being shown */
  days: number;
  isDark?: boolean;
}

export function DataRangeFooter({ days, isDark = false }: DataRangeFooterProps) {
  const { t } = useTranslation();

  const handleExpandPress = () => {
    router.push('/sync-settings' as never);
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Text style={[styles.text, isDark && styles.textMuted]}>
        {t('routes.dataRangeHint', { duration: formatDaySpan(days, t as SpanTranslator) })}
      </Text>
      <Pressable
        style={pressable(styles.button)}
        android_ripple={pressRipple}
        onPress={handleExpandPress}
        hitSlop={8}
      >
        <Text style={[styles.buttonText, isDark && { color: darkColors.linkTeal }]}>
          {t('routes.expandInSettings')}
        </Text>
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
    color: colors.linkTeal,
    fontWeight: '500',
  },
});

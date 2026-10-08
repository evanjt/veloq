/**
 * DataRangeFooter - Discreet footer showing data range with link to expand
 *
 * Shows at the bottom of route/section screens to inform users about
 * the date range of cached data and how to expand it.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography } from '@/theme';
import { Button } from '@/shared/ui';
import { formatDaySpan, type SpanTranslator } from '@/shared/format';
import { tapTo } from '@/shared/app/navigation';

interface DataRangeFooterProps {
  /** Number of days of data being shown */
  days: number;
  isDark?: boolean;
}

export function DataRangeFooter({ days, isDark = false }: DataRangeFooterProps) {
  const { t } = useTranslation();

  const handleExpandPress = () => {
    tapTo('/sync-settings');
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Text style={[styles.text, isDark && styles.textSecondary]}>
        {t('routes.dataRangeHint', { duration: formatDaySpan(days, t as SpanTranslator) })}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        style={styles.button}
        onPress={handleExpandPress}
        label={t('routes.expandInSettings')}
      />
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
  textSecondary: {
    color: darkColors.textSecondary,
  },
  button: {
    marginTop: spacing.xs,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

interface SyncProgressBannerProps {
  completed: number;
  total: number;
  message?: string;
}

export function SyncProgressBanner({ completed, total, message }: SyncProgressBannerProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.syncBanner}>
      <Text style={styles.syncText}>
        {message
          ? message
          : total > 0
            ? t('maps.syncingActivities', { completed, total })
            : t('common.loading')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  syncText: {
    color: colors.textOnDark,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
});

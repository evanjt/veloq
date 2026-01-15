/**
 * Offline banner shown at the top of the screen when the device is offline.
 * Informs users that they're viewing cached data.
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNetwork } from '@/providers';
import { colors, darkColors } from '@/theme';

export function OfflineBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetwork();

  // Don't show banner when online
  if (isOnline) {
    return null;
  }

  // Calculate banner height for notch/Dynamic Island
  const topPadding =
    Platform.OS === 'android' ? Math.max(insets.top, 24) : Math.max(insets.top, 20);

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.content}>
        <MaterialCommunityIcons name="cloud-off-outline" size={16} color={colors.textOnDark} />
        <Text style={styles.text}>{t('emptyState.offline.title')}</Text>
        <Text style={styles.subtitleText}>{t('emptyState.offline.description')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: darkColors.textSecondary,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  text: {
    color: colors.textOnDark,
    fontSize: 13,
    fontWeight: '600',
  },
  subtitleText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
});

/**
 * Offline banner shown at the top of the screen when the device is offline.
 * Informs users that they're viewing cached data.
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNetwork } from '@/shared/app/NetworkContext';
import { colors, darkColors, typography, spacing, colorWithOpacity } from '@/theme';

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
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View style={[styles.container, { paddingTop: topPadding }]} testID="offline-banner">
        <View style={styles.content}>
          <MaterialCommunityIcons name="cloud-off-outline" size={16} color={colors.textOnPrimary} />
          <Text style={styles.text}>{t('emptyState.offline.title')}</Text>
          <Text style={styles.subtitleText}>{t('emptyState.offline.description')}</Text>
        </View>
      </View>
    </Animated.View>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Dark ink, because white on this grey is 2.56:1. Measured 2026-09-15: dark
  // ink on `darkColors.textSecondary` is 6.91:1, and at 0.8 for the subtitle
  // 4.90:1, which keeps the step down in weight inside the bar.
  text: {
    color: colors.textOnPrimary,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
  subtitleText: {
    color: colorWithOpacity(colors.textOnPrimary, 0.8),
    fontSize: typography.caption.fontSize,
  },
});

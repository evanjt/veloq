/**
 * Banner for a connected but degraded network.
 *
 * The offline banner covers a dead radio. This one covers the case that is both
 * more common and more confusing: the device is connected, the sync keeps
 * failing, and every screen just looks empty. It names the engine's error and
 * the last time data actually arrived, so missing activities read as a sync
 * problem rather than an empty account.
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import { useTheme } from '@/shared/app/useTheme';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { formatDateTime } from '@/shared/format';
import { amberBanner } from '@/theme';

export function SyncErrorBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isOnline } = useNetwork();
  const { isDark } = useTheme();
  const { lastError, lastSuccessAt } = useSyncHealth();

  // The offline banner already owns the no-connection case, and both live in the
  // same top slot. A logged-out user has no sync to report on, and the engine
  // keeps the error from the session that just ended.
  if (!isAuthenticated || !isOnline || !lastError) {
    return null;
  }

  const palette = isDark ? amberBanner.dark : amberBanner.light;
  const topPadding =
    Platform.OS === 'android' ? Math.max(insets.top, 24) : Math.max(insets.top, 20);

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View
        style={[styles.container, { paddingTop: topPadding, backgroundColor: palette.bg }]}
        testID="sync-error-banner"
      >
        <View style={styles.content}>
          <View style={styles.headline}>
            <MaterialCommunityIcons name="cloud-alert" size={16} color={palette.text} />
            <Text style={[styles.title, { color: palette.text }]}>
              {t('emptyState.syncError.title')}
            </Text>
          </View>
          <Text numberOfLines={2} style={[styles.detail, { color: palette.subtext }]}>
            {lastError}
          </Text>
          <Text style={[styles.detail, { color: palette.subtext }]}>
            {lastSuccessAt
              ? t('emptyState.syncError.lastSynced', { when: formatDateTime(lastSuccessAt) })
              : t('emptyState.syncError.neverSynced')}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 2,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  detail: {
    fontSize: 12,
    textAlign: 'center',
  },
});

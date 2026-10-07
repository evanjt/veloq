/**
 * The line that says some routes did not download.
 *
 * `SyncErrorBanner` covers the engine's own sync and `OfflineBanner` a dead
 * radio. Neither covers this: the tracks are fetched outside the sync service,
 * so a run that gives up on three of them leaves sync health clean and every
 * banner silent while those routes are missing from the map and matched against
 * no section. It is dismissible because the fetch retries itself on the next
 * refresh, and it comes back if the next run fails on an activity it was not closed for.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { useTheme } from '@/shared/app/useTheme';
import { useBannerPadsStatusBar } from '@/shared/app/TopSafeAreaContext';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { amberBanner, typography, spacing, layout } from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';

export function TrackFetchNotice() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const padsStatusBar = useBannerPadsStatusBar('trackFetch');
  const failedIds = useTrackFetchNotice((s) => s.failedIds);
  const failedCount = useTrackFetchNotice((s) => s.failedCount);
  const dismissed = useTrackFetchNotice((s) => s.dismissed);
  const dismiss = useTrackFetchNotice((s) => s.dismiss);

  if (failedCount === 0 || dismissed) return null;

  const palette = isDark ? amberBanner.dark : amberBanner.light;
  const topPadding = !padsStatusBar
    ? 0
    : Platform.OS === 'android'
      ? Math.max(insets.top, 24)
      : Math.max(insets.top, 20);

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <View
        style={[styles.container, { paddingTop: topPadding, backgroundColor: palette.bg }]}
        testID="track-fetch-notice"
      >
        <View style={styles.content}>
          <View style={styles.headline}>
            <MaterialCommunityIcons name="map-marker-alert" size={16} color={palette.text} />
            <Text style={[styles.title, { color: palette.text }]}>
              {t('emptyState.tracksMissing.title', { count: failedCount })}
            </Text>
          </View>
          <Text numberOfLines={2} style={[styles.detail, { color: palette.subtext }]}>
            {t('emptyState.tracksMissing.detail')}
          </Text>
          {failedIds.length === 1 && (
            <Pressable
              testID="track-fetch-notice-open"
              accessibilityRole="button"
              accessibilityLabel={t('activitySummary.openActivity')}
              onPress={() => router.push(`/activity/${failedIds[0]}`)}
              hitSlop={8}
              style={pressable(styles.action)}
              android_ripple={pressRipple}
            >
              <Text style={[styles.dismiss, { color: palette.text }]}>
                {t('activitySummary.openActivity')}
              </Text>
            </Pressable>
          )}
          <Pressable
            testID="track-fetch-notice-dismiss"
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={dismiss}
            hitSlop={8}
            style={pressable(styles.action)}
            android_ripple={pressRipple}
          >
            <Text style={[styles.dismiss, { color: palette.text }]}>{t('common.close')}</Text>
          </Pressable>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.label,
    fontWeight: '600',
  },
  detail: {
    ...typography.caption,
    textAlign: 'center',
  },
  dismiss: {
    ...typography.label,
    fontWeight: '600',
  },
  action: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
  },
});

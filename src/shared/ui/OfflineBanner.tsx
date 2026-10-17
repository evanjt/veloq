/**
 * Offline pill floating under the status bar while the device is offline.
 * Informs users that they're viewing cached data. It shows once the provider
 * says so, which trails the offline reading by a delay, and it hides on the
 * render the device comes back.
 *
 * It floats over the screen rather than taking the top slot, so it moves no
 * screen's edge on the way in or out, and it passes every touch through to
 * what is beneath it. It starts below any banner in the slot.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNetwork } from '@/shared/app/NetworkContext';
import { useFloatingPillTop } from '@/shared/app/TopSafeAreaContext';
import { useAnnounceOnAppear } from './useAnnounceOnAppear';
import {
  colorWithOpacity,
  iconSize,
  layout,
  motionPresets,
  offlinePill,
  shadows,
  spacing,
  typography,
} from '@/theme';

export function OfflineBanner() {
  const { t } = useTranslation();
  const top = useFloatingPillTop();
  const { offlineBannerShown } = useNetwork();

  useAnnounceOnAppear(
    offlineBannerShown
      ? `${t('emptyState.offline.title')}. ${t('emptyState.offline.description')}`
      : null
  );

  if (!offlineBannerShown) {
    return null;
  }

  return (
    <Animated.View
      {...motionPresets.pill}
      style={[styles.container, { top }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <View style={[styles.pill, shadows.elevated]} testID="offline-pill">
        <MaterialCommunityIcons
          name="cloud-off-outline"
          size={iconSize.sm}
          color={offlinePill.text}
        />
        <Text style={styles.text} numberOfLines={1} testID="offline-banner-text">
          {t('emptyState.offline.title')}
          <Text style={styles.subtitleText}>
            {' · '}
            {t('emptyState.offline.description')}
          </Text>
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    gap: spacing.xs,
    borderRadius: layout.borderRadiusFull,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: offlinePill.bg,
  },
  text: {
    flexShrink: 1,
    color: offlinePill.text,
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
  subtitleText: {
    color: colorWithOpacity(offlinePill.text, 0.8),
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
  },
});

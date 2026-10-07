import React from 'react';
import { Alert, View, StyleSheet, Pressable } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useBannerPadsStatusBar } from '@/shared/app/TopSafeAreaContext';
import { pressable, pressRipple } from '@/shared/ui';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useTheme } from '@/shared/app';
import { colors, brand, ink, typography, spacing, colorWithOpacity } from '@/theme';
import { clearDemoData } from '@/shared/storage';
import { engineErrorKey } from '@/shared/native/engineError';

export function DemoBanner() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const padsStatusBar = useBannerPadsStatusBar('demo');
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const hideDemoBanner = useAuthStore((state) => state.hideDemoBanner);
  const exitDemoMode = useAuthStore((state) => state.exitDemoMode);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);

  // Don't render if not in demo mode or if banner is hidden
  if (!isDemoMode || hideDemoBanner) return null;

  const handlePress = async () => {
    await exitDemoMode();
    resetSyncDateRange();
    // Defer data clearing until the navigation interaction completes. Calling
    // queryClient.clear() while tab screens are still mounted triggers a mass
    // re-render cascade that crashes Android with IllegalStateException
    // (null child in ReactViewGroup during dispatchGetDisplayList).
    //
    // The banner is gone by the time this runs, so a wipe that fails has to
    // say so here or the fixtures stay on disk with nothing on screen.
    runWhenIdle(async () => {
      try {
        await clearDemoData(queryClient);
      } catch (error) {
        Alert.alert(t('alerts.error'), t(engineErrorKey(error, 'alerts.failedToClear')));
      }
    });
  };

  return (
    <Animated.View entering={SlideInUp.duration(250)} exiting={SlideOutUp.duration(200)}>
      <Pressable
        testID="demo-mode-banner"
        onPress={handlePress}
        style={pressable([
          styles.container,
          isDark && styles.containerDark,
          { paddingTop: !padsStatusBar ? 0 : insets.top > 0 ? insets.top : spacing.sm },
        ])}
        android_ripple={pressRipple}
      >
        <View style={styles.content}>
          <MaterialCommunityIcons
            name="information"
            size={18}
            color={isDark ? ink.white : colors.textOnPrimary}
            style={styles.icon}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('demo.banner', { defaultValue: 'Demo Mode' })}
          </Text>
          <Text style={[styles.subtext, isDark && styles.subtextDark]}>
            {t('demo.tapToSignIn', { defaultValue: 'Tap to sign in' })}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? ink.white : colors.textOnPrimary}
            style={styles.chevron}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: brand.blue, // Brand blue for demo mode
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  containerDark: {
    backgroundColor: brand.blueDark, // Darker blue for dark mode
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: spacing.sm,
  },
  // Dark ink on the light fill, white on the dark one. White on `brand.blue`
  // is 2.96:1, and dark ink on `brand.blueDark` is 3.93:1, so neither ink
  // carries both fills and the scheme decides. Measured 2026-09-15: dark ink
  // on blue 5.99:1, white on blueDark 4.51:1.
  text: {
    color: colors.textOnPrimary,
    fontWeight: '600',
    fontSize: typography.bodySmall.fontSize,
  },
  textDark: {
    color: colors.textOnDark,
  },
  // The subtitle keeps its step down in weight, at the strongest alpha that
  // still clears the bar: dark ink at 0.85 is 4.78:1, and on the dark fill
  // white has no headroom to give at all, so it goes full strength for 4.51:1.
  subtext: {
    color: colorWithOpacity(colors.textOnPrimary, 0.85),
    fontSize: typography.bodyCompact.fontSize,
    marginLeft: spacing.sm,
  },
  subtextDark: {
    color: ink.white,
  },
  chevron: {
    marginLeft: spacing.xs,
  },
});

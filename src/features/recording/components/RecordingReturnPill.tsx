import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { usePathname } from 'expo-router';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { colors, darkColors, brand, spacing, shadows } from '@/theme';
import { TAB_BAR_HEIGHT, GRADIENT_HEIGHT } from '@/shared/ui/BottomTabBar';
import { getActivityIcon } from '@/features/activity/lib/activityUtils';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useTimer } from '@/features/recording/hooks/useTimer';

/**
 * Global pill shown while a recording session is active and the user has
 * navigated elsewhere in the app. Tapping returns to the live screen.
 * Rendered once in the root layout.
 */
export function RecordingReturnPill() {
  const status = useRecordingStore((s) => s.status);
  const pathname = usePathname();

  const active = status === 'recording' || status === 'paused';
  const onRecordingScreens =
    pathname.startsWith('/recording') || pathname === '/record' || pathname.startsWith('/record/');
  if (!active || onRecordingScreens) return null;

  return <RecordingReturnPillInner paused={status === 'paused'} />;
}

function RecordingReturnPillInner({ paused }: { paused: boolean }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const activityType = useRecordingStore((s) => s.activityType);
  const { formattedElapsed } = useTimer();

  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const accent = paused ? colors.warning : brand.teal;
  const bottomOffset = TAB_BAR_HEIGHT + GRADIENT_HEIGHT + insets.bottom + spacing.sm;

  return (
    <Animated.View
      style={[styles.container, { bottom: bottomOffset }]}
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(200)}
      pointerEvents="box-none"
    >
      <Pressable
        testID="recording-return-pill"
        style={[styles.pill, { backgroundColor: bgColor }, shadows.elevated]}
        onPress={() => activityType && navigateTo(`/recording/${activityType}`)}
        accessibilityRole="button"
        accessibilityLabel={t('recording.returnToRecording', 'Return to recording')}
      >
        <View style={[styles.dot, { backgroundColor: accent }]} />
        {activityType && (
          <MaterialCommunityIcons name={getActivityIcon(activityType)} size={18} color={accent} />
        )}
        <Text style={[styles.elapsed, { color: textPrimary }]}>{formattedElapsed}</Text>
        <Text style={[styles.label, { color: accent }]}>
          {paused
            ? t('recording.status.paused', 'Paused')
            : t('recording.status.recording', 'Recording')}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={accent} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  elapsed: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});

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
import { colors, darkColors, brand, spacing, shadows, layout, typography } from '@/theme';
import { TAB_BAR_HEIGHT, GRADIENT_HEIGHT } from '@/shared/ui/BottomTabBar';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { pressable, pressRipple } from '@/shared/ui';
import { sessionReturnRoute } from '@/features/recording/lib/sessionReturnRoute';
import type { RecordingStatus } from '@/types';

/**
 * Global pill shown while a session is in the store and the user has navigated
 * elsewhere in the app. Tapping returns to the live screen, or to review for a
 * stopped ride that is not saved yet.
 * Rendered once in the root layout.
 */
export function RecordingReturnPill() {
  const status = useRecordingStore((s) => s.status);
  const owner = useRecordingStore((s) => s.athleteId);
  const mode = useRecordingStore((s) => s.mode);
  const savedToLibrary = useRecordingStore((s) => s.savedToLibrary);
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const athleteId = useAuthStore((s) => s.athleteId);
  const pathname = usePathname();

  const onRecordingScreens =
    pathname.startsWith('/recording') || pathname === '/record' || pathname.startsWith('/record/');
  if (
    !authenticated ||
    !owner ||
    owner !== athleteId ||
    mode === 'manual' ||
    savedToLibrary ||
    status === 'idle' ||
    onRecordingScreens
  )
    return null;

  return <RecordingReturnPillInner status={status} />;
}

function RecordingReturnPillInner({ status }: { status: RecordingStatus }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const activityType = useRecordingStore((s) => s.activityType);
  const { formattedElapsed } = useTimer();
  const paused = status === 'paused';
  const stopped = status === 'stopped';
  const route = sessionReturnRoute({ status, activityType });

  const bgColor = isDark ? darkColors.surfaceElevated : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const accent = paused ? (isDark ? darkColors.warningAmber : colors.warningAmber) : brand.teal;
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
        style={pressable([styles.pill, { backgroundColor: bgColor }, shadows.elevated])}
        android_ripple={pressRipple}
        onPress={() => route && navigateTo(route)}
        accessibilityRole="button"
        accessibilityLabel={t('recording.returnToRecording', 'Return to recording')}
      >
        <View style={[styles.dot, { backgroundColor: accent }]} />
        {activityType && (
          <MaterialCommunityIcons name={getActivityIcon(activityType)} size={18} color={accent} />
        )}
        <Text style={[styles.elapsed, { color: textPrimary }]}>{formattedElapsed}</Text>
        <Text style={[styles.label, { color: accent }]}>
          {stopped
            ? t('recording.reviewActivity', 'Review Activity')
            : paused
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
    borderRadius: layout.borderRadiusXl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: layout.borderRadiusFull,
  },
  elapsed: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
  },
});

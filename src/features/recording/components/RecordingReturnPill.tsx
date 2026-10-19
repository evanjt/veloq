import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { useScreenPathname } from '@/shared/app/screenUnderSheet';
import { colors, darkColors, iconSize, layout, recording, typography, themePalette } from '@/theme';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { FloatingPill } from '@/shared/ui/FloatingPill';
import { Icon } from '@/shared/ui/Icon';
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
  // A sheet over the recording screen leaves the ride on display.
  const pathname = useScreenPathname();

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
  const palette = isDark ? darkColors : colors;
  const activityType = useRecordingStore((s) => s.activityType);
  const { formattedElapsed } = useTimer();
  const paused = status === 'paused';
  const stopped = status === 'stopped';
  const route = sessionReturnRoute({ status, activityType });

  // A live ride reads the record role, a paused one the warning mark, and a stopped one the
  // action colour, since what is left is the tap through to review.
  const accent = paused
    ? palette.warningText
    : stopped
      ? themePalette(isDark).actionPrimary
      : recording[isDark ? 'dark' : 'light'];

  return (
    <FloatingPill
      testID="recording-return-pill"
      onPress={() => route && navigateTo(route)}
      accessibilityLabel={t('recording.returnToRecording', 'Return to recording')}
      lead={
        <>
          <View
            testID="recording-return-pill-dot"
            style={[styles.dot, { backgroundColor: accent }]}
          />
          {activityType ? (
            <Icon name={getActivityIcon(activityType)} size={iconSize.sm} color={accent} />
          ) : null}
          <Text
            testID="recording-return-pill-elapsed"
            style={[styles.elapsed, { color: palette.textPrimary }]}
          >
            {formattedElapsed}
          </Text>
        </>
      }
      title={
        stopped
          ? t('recording.reviewActivity', 'Review activity')
          : paused
            ? t('recording.status.paused', 'Paused')
            : t('recording.status.recording', 'Recording')
      }
      titleColor={accent}
    />
  );
}

const styles = StyleSheet.create({
  // The record dot, a step larger than a chart's legend dot so it reads as the live mark.
  dot: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  elapsed: {
    ...typography.pillValue,
  },
});

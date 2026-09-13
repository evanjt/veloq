/**
 * The three seconds between a one-tap entry and the ride starting.
 *
 * A pocket tap on a widget, an iOS Control or a launcher shortcut reaches the
 * recording screen directly, so the only thing standing between it and a
 * recorded ride is this. It covers the screen because the athlete has to be
 * able to stop it without aiming.
 */
import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography, layout } from '@/theme';

export const ARMED_COUNTDOWN_TEST_ID = 'recording-armed-countdown';
export const ARMED_COUNTDOWN_CANCEL_TEST_ID = 'recording-armed-countdown-cancel';

interface ArmedCountdownOverlayProps {
  /** Seconds left. The overlay is not rendered at all when nothing is armed. */
  secondsLeft: number;
  activityType: string;
  onCancel: () => void;
}

export function ArmedCountdownOverlay({
  secondsLeft,
  activityType,
  onCancel,
}: ArmedCountdownOverlayProps) {
  const { t } = useTranslation();
  const sportLabel = t(`activityTypes.${activityType}` as never, activityType) as string;

  return (
    <View style={styles.backdrop} testID={ARMED_COUNTDOWN_TEST_ID}>
      <Text style={styles.sport}>{sportLabel}</Text>
      <Text
        style={styles.count}
        accessibilityLabel={t('recording.startingIn', { seconds: secondsLeft })}
      >
        {secondsLeft}
      </Text>
      <Text style={styles.caption}>{t('recording.startingIn', { seconds: secondsLeft })}</Text>
      <Pressable
        testID={ARMED_COUNTDOWN_CANCEL_TEST_ID}
        onPress={onCancel}
        style={styles.cancel}
        accessibilityRole="button"
      >
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    bottom: 0,
    backgroundColor: darkColors.background,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  cancel: {
    borderColor: darkColors.border,
    borderRadius: layout.borderRadiusMd,
    borderWidth: 1,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  cancelText: {
    ...typography.bodyBold,
    color: darkColors.textPrimary,
  },
  caption: {
    ...typography.body,
    color: darkColors.textSecondary,
    marginTop: spacing.sm,
  },
  count: {
    ...typography.heroNumber,
    color: colors.primary,
    marginTop: spacing.md,
  },
  sport: {
    ...typography.sectionTitle,
    color: darkColors.textPrimary,
  },
});

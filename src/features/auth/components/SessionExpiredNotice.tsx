import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { StatusLine } from '@/shared/ui';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { formatClockOrDate } from '@/shared/format/format';
import type { SessionExpiryNotice } from '@/features/auth/hooks';

interface SessionExpiredNoticeProps {
  notice: SessionExpiryNotice;
}

export const SessionExpiredNotice = React.memo(function SessionExpiredNotice({
  notice,
}: SessionExpiredNoticeProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { reason, cachedAthleteId, heldRideStart } = notice;

  const iconColour = isDark ? darkColors.warningAmber : colors.warningAmber;
  const title =
    reason === 'key_rejected' ? t('login.sessionKeyRejected') : t('login.sessionSignedOut');
  const kept = t('login.sessionDataKept');
  const heldRide =
    heldRideStart !== null
      ? t('login.sessionHeldRide', { when: formatClockOrDate(heldRideStart) })
      : null;
  const restore = cachedAthleteId
    ? t('login.sessionRestoreAthlete', { athleteId: cachedAthleteId })
    : t('login.sessionRestore');

  return (
    <StatusLine
      tone="info"
      message={heldRide ? [title, kept, heldRide, restore] : [title, kept, restore]}
      style={[styles.notice, isDark && styles.noticeDark]}
      testID="login-session-notice"
    >
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="account-clock-outline"
          size={iconSize.md}
          color={iconColour}
        />
        <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>
      </View>
      <Text style={[styles.detail, isDark && styles.detailDark]}>{kept}</Text>
      {heldRide !== null && (
        <Text style={[styles.detail, isDark && styles.detailDark]} testID="login-session-held-ride">
          {heldRide}
        </Text>
      )}
      <Text style={[styles.detail, isDark && styles.detailDark]}>{restore}</Text>
    </StatusLine>
  );
});

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colorWithOpacity(colors.warning, 0.08),
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: stroke.one,
    borderColor: colorWithOpacity(colors.warning, 0.2),
  },
  noticeDark: {
    backgroundColor: colorWithOpacity(colors.warning, 0.12),
    borderColor: colorWithOpacity(colors.warning, 0.28),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  detail: {
    fontSize: typography.bodyCompact.fontSize,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});

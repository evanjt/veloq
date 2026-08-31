import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, colorWithOpacity, darkColors, spacing } from '@/theme';
import type { SessionExpiryNotice } from '@/features/auth/hooks';

interface SessionExpiredNoticeProps {
  notice: SessionExpiryNotice;
}

export const SessionExpiredNotice = React.memo(function SessionExpiredNotice({
  notice,
}: SessionExpiredNoticeProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { reason, cachedAthleteId } = notice;

  const iconColour = isDark ? darkColors.warningAmber : colors.warningAmber;

  return (
    <View style={[styles.notice, isDark && styles.noticeDark]} testID="login-session-notice">
      <View style={styles.header}>
        <MaterialCommunityIcons name="account-clock-outline" size={20} color={iconColour} />
        <Text style={[styles.title, isDark && styles.titleDark]}>
          {reason === 'token_revoked' ? t('login.sessionRevoked') : t('login.sessionExpired')}
        </Text>
      </View>
      <Text style={[styles.detail, isDark && styles.detailDark]}>{t('login.sessionDataKept')}</Text>
      <Text style={[styles.detail, isDark && styles.detailDark]}>
        {cachedAthleteId
          ? t('login.sessionRestoreAthlete', { athleteId: cachedAthleteId })
          : t('login.sessionRestore')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colorWithOpacity(colors.warning, 0.08),
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
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
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  detail: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});

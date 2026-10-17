import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InlineNotice } from '@/shared/ui';
import { spacing } from '@/theme';
import { formatClockOrDate } from '@/shared/format/format';
import type { SessionExpiryNotice } from '@/features/auth/hooks';

interface SessionExpiredNoticeProps {
  notice: SessionExpiryNotice;
}

export const SessionExpiredNotice = React.memo(function SessionExpiredNotice({
  notice,
}: SessionExpiredNoticeProps) {
  const { t } = useTranslation();
  const { reason, cachedAthleteId, heldRideStart } = notice;

  const title =
    reason === 'key_rejected' ? t('login.sessionKeyRejected') : t('login.sessionSignedOut');
  const heldRide =
    heldRideStart !== null
      ? t('login.sessionHeldRide', { when: formatClockOrDate(heldRideStart) })
      : null;
  const restore = cachedAthleteId
    ? t('login.sessionRestoreAthlete', { athleteId: cachedAthleteId })
    : t('login.sessionRestore');

  return (
    <InlineNotice
      tone="warning"
      icon="account-clock-outline"
      title={title}
      detail={[t('login.sessionDataKept'), heldRide, restore]}
      style={styles.notice}
      testID="login-session-notice"
    />
  );
});

const styles = StyleSheet.create({
  notice: {
    marginBottom: spacing.md,
  },
});

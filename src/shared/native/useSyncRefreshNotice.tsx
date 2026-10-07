import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { StartOutcome } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { spacing } from '@/theme';

import { requestSyncRefresh } from './syncRefresh';

type NoticeKey =
  | 'refresh.busy'
  | 'refresh.notReady'
  | 'refresh.offline'
  | 'refresh.notConfigured'
  | 'refresh.failed';

export function syncRefreshNoticeKey(outcome: StartOutcome): NoticeKey | null {
  switch (outcome) {
    case StartOutcome.Busy:
    case StartOutcome.Held:
      return 'refresh.busy';
    case StartOutcome.NotReady:
      return 'refresh.notReady';
    case StartOutcome.Offline:
      return 'refresh.offline';
    case StartOutcome.NotConfigured:
      return 'refresh.notConfigured';
    case StartOutcome.Failed:
      return 'refresh.failed';
    default:
      return null;
  }
}

export function useSyncRefreshNotice() {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const requestRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const key = syncRefreshNoticeKey(requestSyncRefresh());
    const message = key ? t(key) : null;
    setNotice(message);
    if (!message) return;
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, [t]);

  return { notice, requestRefresh };
}

export function SyncRefreshNotice({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={styles.line}>
      <Text style={{ color: colors.textSecondary }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});

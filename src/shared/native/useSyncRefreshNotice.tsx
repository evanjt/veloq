import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { StartOutcome } from 'veloqrs';

import { useTabBarClearance } from '@/shared/ui/tabBarClearance';

import { requestSyncRefresh } from './syncRefresh';

/** A refused pull is feedback to the gesture, so it shows briefly and goes. */
const NOTICE_MS = 3000;

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
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, [t]);

  return { notice, requestRefresh };
}

/**
 * The refused pull as a snackbar above the tab bar. Render it as the screen's
 * last child so it draws over the content. The hook owns its time, so a second
 * pull restarts the one snackbar rather than queueing another.
 */
export function SyncRefreshNotice({ message }: { message: string | null }) {
  // Kept through the hide animation, which runs after the message has cleared.
  const [shown, setShown] = useState(message);
  const tabBarClearance = useTabBarClearance();
  if (message && message !== shown) setShown(message);
  return (
    <Snackbar
      testID="sync-refresh-snackbar"
      visible={message !== null}
      onDismiss={noop}
      duration={Number.POSITIVE_INFINITY}
      wrapperStyle={{ bottom: tabBarClearance }}
    >
      {shown}
    </Snackbar>
  );
}

function noop() {}

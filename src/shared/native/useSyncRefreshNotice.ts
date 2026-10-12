import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StartOutcome } from 'veloqrs';

import { hideNotice, showNotice } from '@/shared/ui/Notice';

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

/** Pulls to refresh, and shows a refused pull through the app notice. */
export function useSyncRefreshNotice() {
  const { t } = useTranslation();
  const shown = useRef<number | null>(null);

  const requestRefresh = useCallback(() => {
    // The next pull answers for itself, so an earlier refusal goes whatever it says.
    if (shown.current !== null) hideNotice(shown.current);
    const key = syncRefreshNoticeKey(requestSyncRefresh());
    shown.current = key ? showNotice({ message: t(key), duration: NOTICE_MS }) : null;
  }, [t]);

  return { requestRefresh };
}

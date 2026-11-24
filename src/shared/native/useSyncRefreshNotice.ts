import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FfiStartOutcome } from 'veloqrs';

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

function syncRefreshNoticeKey(outcome: FfiStartOutcome): NoticeKey | null {
  switch (outcome) {
    case FfiStartOutcome.Busy:
    case FfiStartOutcome.Held:
      return 'refresh.busy';
    case FfiStartOutcome.NotReady:
      return 'refresh.notReady';
    case FfiStartOutcome.Offline:
      return 'refresh.offline';
    case FfiStartOutcome.NotConfigured:
      return 'refresh.notConfigured';
    case FfiStartOutcome.Failed:
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

import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { HISTORY_RANGE_PARAM } from './historyRangeParam';
import { openSheet } from './sheetRequest';

export { HISTORY_RANGE_PARAM };

/**
 * Opens the activity history sheet over the screen that asked for it. Every control that offers
 * to widen the downloaded range calls this, so none of them navigates away from where the athlete
 * is.
 */
export function openHistoryRange(): void {
  void openSheet<Record<string, never>, never>('sheets/history-range', {});
}

/**
 * Settings' side of the retired history range link: a request in the query opens the sheet once
 * and is cleared, so returning to Settings does not open it again.
 */
export function useOpenHistoryRangeFromLink(): void {
  const params = useLocalSearchParams<Record<string, string | undefined>>();
  const { setParams } = useRouter();
  const requested = params[HISTORY_RANGE_PARAM] === '1';
  useEffect(() => {
    if (!requested) return;
    openHistoryRange();
    setParams({ [HISTORY_RANGE_PARAM]: undefined });
  }, [requested, setParams]);
}

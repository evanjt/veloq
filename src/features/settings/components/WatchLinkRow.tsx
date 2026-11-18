/**
 * The Apple Watch link switch, on the notifications spoke beside the other things that reach the
 * athlete away from the phone. It renders only where the watch module is present, which is the
 * iOS build.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isWatchLinkAvailable,
  isWatchLinkEnabled,
  setWatchLinkEnabled,
} from '@/shared/native/watchLink';
import { SwitchRow } from '@/shared/ui/SwitchRow';

export function WatchLinkRow() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(isWatchLinkEnabled);

  const handleToggle = useCallback((next: boolean) => {
    setWatchLinkEnabled(next);
    setEnabled(next);
  }, []);

  if (!isWatchLinkAvailable()) return null;

  return (
    <SwitchRow
      icon="watch"
      title={t('settings.watchLink')}
      description={t('settings.watchLinkDescription')}
      value={enabled}
      onValueChange={handleToggle}
      testID="watch-link-switch"
    />
  );
}

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { goBack } from '@/shared/app/navigation';
import { Button } from '@/shared/ui';

/**
 * Leaves the recording screen while nothing is recording. The screen has no
 * header and no edge swipe, so this is the only way off before a session
 * starts. It goes back, or to the feed when nothing is behind the screen, as
 * when the app was opened straight into it.
 */
export function RecordingCloseButton(): React.JSX.Element {
  const { t } = useTranslation();
  const close = useCallback(() => goBack(), []);

  return (
    <Button
      testID="recording-close"
      label={t('common.close', 'Close')}
      variant="ghost"
      size="sm"
      onPress={close}
    />
  );
}

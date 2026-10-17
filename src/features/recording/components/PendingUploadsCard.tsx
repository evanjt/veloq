import React, { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { getVisibleUnuploadedCount } from '@/features/recording/lib/storage/recordingLibrary';

/** Home banner shown while locally saved recordings are not yet on intervals.icu. */
function PendingUploadsCardInner() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getVisibleUnuploadedCount().then((n) => {
        if (!cancelled) setCount(n);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (count === 0) return null;

  return (
    <InlineNotice
      testID="pending-uploads-card"
      tone="info"
      icon="cloud-upload-outline"
      title={t('recording.library.pendingUploads', { count })}
      onPress={() => navigateTo('/recordings')}
      announce={false}
    />
  );
}

export const PendingUploadsCard = React.memo(PendingUploadsCardInner);

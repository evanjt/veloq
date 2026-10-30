import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { TextLink } from '@/shared/ui/TextLink';

/**
 * The chart note for a range whose activities are not all on the device. It
 * opens the sync settings, where the download's progress and the daily limit
 * are shown.
 */
export function RangePartlyDownloadedNote({
  testID,
  style,
}: {
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  return (
    <TextLink
      testID={testID}
      style={style}
      size="caption"
      label={t('stats.rangePartlyDownloaded')}
      onPress={() => navigateTo('/sync-settings')}
    />
  );
}

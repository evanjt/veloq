/**
 * The line for a body the engine has not stored, with a Retry once the wait for it is over.
 *
 * An on-demand fetch can end without a body: its deadline passes, or the engine refuses it.
 * Only a reconnect re-asks on its own, so a fetch that failed while the radio was up is asked
 * for again from here or not at all. While the wait is still running there is nothing to retry.
 */

import React from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { waitEnded, type EngineBodyStatus } from '@/shared/native/engineBodies';
import { Button } from './Button';

interface BodyNotDownloadedProps {
  /** What is missing, already translated. */
  message: string;
  /** The wait for the body, from `useEngineBody`. */
  status: EngineBodyStatus;
  onRetry: () => void;
  /** The block's id; the Retry takes it with `-retry` after it. */
  testID: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function BodyNotDownloaded({
  message,
  status,
  onRetry,
  testID,
  style,
  textStyle,
}: BodyNotDownloadedProps) {
  const { t } = useTranslation();
  return (
    <View testID={testID} style={style}>
      <Text style={textStyle}>{message}</Text>
      {waitEnded(status) && (
        <Button
          label={t('common.retry')}
          variant="ghost"
          onPress={onRetry}
          testID={`${testID}-retry`}
        />
      )}
    </View>
  );
}

/**
 * The line for a body the engine has not stored, with a Retry once the wait for it is over.
 *
 * An on-demand fetch can end without a body: its deadline passes, or the engine refuses it.
 * Only a reconnect re-asks on its own, so a fetch that failed while the radio was up is asked
 * for again from here or not at all. While the wait is still running there is nothing to retry.
 *
 * Offline and signed out end the wait too, and a Retry cannot succeed under either, so the
 * block names the fix instead: the connection, which re-asks by itself, or signing in.
 */

import React from 'react';
import { type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { waitEnded, type EngineBodyStatus } from '@/shared/native/engineBodies';
import { RetryButton } from './ErrorState';
import { StatusLine } from './StatusLine';

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

/** What will fix a wait that ended on a refusal Retry cannot lift. */
function reasonKey(status: EngineBodyStatus) {
  if (status === 'offline') return 'refresh.offline' as const;
  if (status === 'notConfigured') return 'settings.streamBackfillRefusedNotConfigured' as const;
  return null;
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
  const reason = reasonKey(status);
  return (
    <StatusLine tone="info" message={message} testID={testID} style={style}>
      <Text style={textStyle}>{message}</Text>
      {reason ? <Text style={textStyle}>{t(reason)}</Text> : null}
      {waitEnded(status) && <RetryButton onPress={onRetry} testID={`${testID}-retry`} />}
    </StatusLine>
  );
}

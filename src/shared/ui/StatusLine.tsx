/**
 * A result, error or fallback that appears in place, spoken when it does.
 *
 * Nothing moves focus when one of these appears, so a screen reader says
 * nothing unless it is told. Android speaks a view's `accessibilityLiveRegion`
 * by itself, iOS needs the announcement `useAnnounceOnAppear` makes, and this
 * carries both. A failure interrupts; a result, a confirmation or a run still
 * going waits its turn.
 */

import React, { type ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { useAnnounceOnAppear } from './useAnnounceOnAppear';

/** `error` is assertive. `success`, `pending` and `info` are polite. */
export type StatusTone = 'error' | 'success' | 'pending' | 'info';

type MessagePart = string | null | undefined | false;

interface StatusLineProps {
  /**
   * What the screen reader says. Parts join into one announcement, each ended
   * as a sentence, and empty parts drop out.
   */
  message: MessagePart | readonly MessagePart[];
  tone: StatusTone;
  /** What is drawn. Without children the message is drawn as one text. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

const SENTENCE_END = /[.!?…。！？]$/;

/** The parts as one announcement, or null when every part is empty. */
export function joinStatusMessage(message: MessagePart | readonly MessagePart[]): string | null {
  const parts = (Array.isArray(message) ? message : [message])
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return parts.map((part) => (SENTENCE_END.test(part) ? part : `${part}.`)).join(' ');
}

export function StatusLine({ message, tone, children, style, textStyle, testID }: StatusLineProps) {
  const spoken = joinStatusMessage(message);
  useAnnounceOnAppear(spoken);
  return (
    <View
      style={style}
      testID={testID}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
    >
      {children ?? <Text style={textStyle}>{spoken}</Text>}
    </View>
  );
}

/**
 * The mark drawn between two items on one line, a dot or a bar.
 *
 * It is drawn for the eye and is not read: a screen reader moves from one item
 * to the next, and a lone dot between them would be a stop of its own.
 */

import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { hiddenFromScreenReader } from './Icon';

const MARKS = { dot: '·', bar: '|' } as const;

interface TextSeparatorProps {
  mark?: keyof typeof MARKS;
  style?: StyleProp<TextStyle>;
}

export function TextSeparator({ mark = 'dot', style }: TextSeparatorProps) {
  return (
    <Text style={style} {...hiddenFromScreenReader}>
      {MARKS[mark]}
    </Text>
  );
}

/**
 * A name the athlete gave: an activity, a route, a section, a sensor. It wraps
 * to a second line before it ends in an ellipsis, and a screen reader reads it
 * whole.
 *
 * Names are the athlete's own words and are often long, and the end of one is
 * usually what tells two of them apart, so a single line is never enough.
 */

import React from 'react';
import { Text, type TextProps } from 'react-native-paper';

/** Lines a name takes before it is cut. */
const NAME_LINES = 2;

interface NameTextProps extends Omit<TextProps<never>, 'children' | 'ref'> {
  /** The name, absent while it loads or when the athlete never gave one. */
  children: string | null | undefined;
}

export function NameText({ children, accessibilityLabel, ...props }: NameTextProps) {
  return (
    <Text
      numberOfLines={NAME_LINES}
      ellipsizeMode="tail"
      accessibilityLabel={accessibilityLabel ?? children ?? undefined}
      {...props}
    >
      {children}
    </Text>
  );
}

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { layout, spacing } from '@/theme';

/** The diameter of a key dot. */
const KEY_DOT_SIZE = spacing.sm;

interface KeyDotProps {
  /** The colour of the series the dot keys. */
  color: string;
  testID?: string | undefined;
}

/**
 * The dot that keys a value to the series drawn in its colour. Text beside it
 * stays in the theme's ink: the series colour is carried by the dot alone. It
 * is drawn only, and the value beside it is what a screen reader hears.
 */
export function KeyDot({ color, testID }: KeyDotProps) {
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      style={[styles.dot, { backgroundColor: color }]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    width: KEY_DOT_SIZE,
    height: KEY_DOT_SIZE,
    borderRadius: layout.borderRadiusFull,
  },
});

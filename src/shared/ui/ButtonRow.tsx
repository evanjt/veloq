/**
 * Equal actions side by side, or stacked when they cannot sit side by side without cutting a word.
 *
 * A row of `flex: 1` buttons divides the width three ways without asking what each label needs.
 * A button's label wraps at spaces and the button grows, which is right, but a word wider than the
 * button's room is broken inside the word. So this measures the words of every label as the button
 * draws them, at the current text size, and sits the buttons in a row only when each share holds
 * the widest word of its label with the button's padding and glyph. Otherwise the buttons stack at
 * full width. Set equal actions through this, never as `flex: 1` siblings.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Button, buttonChromeWidth, buttonLabelType, type ButtonProps } from '@/shared/ui/Button';
import { buttonRowLayout, labelWords } from '@/shared/ui/buttonRowLayout';
import { spacing } from '@/theme';

export interface ButtonRowProps {
  actions: readonly ButtonProps[];
  testID?: string;
}

export function ButtonRow({ actions, testID }: ButtonRowProps) {
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<Readonly<Record<string, number>>>({});

  const wordWidths = actions.map((action, i) =>
    Math.max(0, ...labelWords(action.label).map((_, j) => measured[`${i}:${j}`] ?? 0))
  );
  const chromeWidths = actions.map((action) =>
    buttonChromeWidth(
      action.size ?? 'md',
      action.icon !== undefined || action.expanded !== undefined
    )
  );
  const stacked = buttonRowLayout({ width, gap: spacing.sm, wordWidths, chromeWidths }) === 'stack';

  return (
    <View
      testID={testID}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={stacked ? styles.stack : styles.row}
    >
      {actions.map((action, i) => (
        <Button key={i} {...action} style={[action.style, stacked ? styles.full : styles.share]} />
      ))}
      <View
        style={styles.probe}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {actions.flatMap((action, i) =>
          labelWords(action.label).map((word, j) => (
            <Text
              key={`${i}:${j}`}
              testID={testID ? `${testID}-word-${i}-${j}` : undefined}
              style={buttonLabelType(action.size ?? 'md')}
              onLayout={(event: LayoutChangeEvent) => {
                const next = event.nativeEvent.layout.width;
                setMeasured((prev) =>
                  prev[`${i}:${j}`] === next ? prev : { ...prev, [`${i}:${j}`]: next }
                );
              }}
            >
              {word}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stack: {
    gap: spacing.sm,
  },
  share: {
    flex: 1,
  },
  full: {
    alignSelf: 'stretch',
  },
  // Out of the flow and invisible, each word on a line of its own so it reports its drawn width.
  probe: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
});

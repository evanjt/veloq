/**
 * A passage clamped to three lines, with a press that opens the rest.
 *
 * The line count is read from an unclamped copy laid out at the same width
 * and kept out of sight and out of the accessibility tree, because a clamped
 * text reports its lines differently on each platform. The button appears
 * only once that copy has measured past the clamp, so a passage that fits
 * never carries one. Opening and closing change the line count and nothing
 * animates the height.
 *
 * A screen reader reads the whole passage either way, from the label, and the
 * button exposes whether it is open.
 */

import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextLayoutEvent,
  type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';

import { TextLink } from './TextLink';

/** The lines a passage shows before it is opened. */
export const EXPANDABLE_TEXT_LINES = 3;

export interface ExpandableTextProps {
  text: string;
  /** Outer spacing only. */
  style?: StyleProp<ViewStyle>;
  /** Prefixes the text (`-text`), its measuring copy (`-measure`) and the button (`-toggle`). */
  testID?: string;
}

export function ExpandableText({ text, style, testID = 'expandable-text' }: ExpandableTextProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [lineCount, setLineCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const onMeasure = useCallback((event: TextLayoutEvent) => {
    setLineCount(event.nativeEvent.lines.length);
  }, []);
  const toggle = useCallback(() => setExpanded((open) => !open), []);

  const overflows = lineCount !== null && lineCount > EXPANDABLE_TEXT_LINES;
  const tint = { color: isDark ? darkColors.textPrimary : colors.textPrimary };

  return (
    <View style={style}>
      <View>
        <Text
          testID={`${testID}-text`}
          style={[styles.text, tint]}
          numberOfLines={expanded ? undefined : EXPANDABLE_TEXT_LINES}
          accessibilityLabel={text}
        >
          {text}
        </Text>
        <Text
          testID={`${testID}-measure`}
          style={[styles.text, styles.measure]}
          onTextLayout={onMeasure}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {text}
        </Text>
      </View>
      {overflows ? (
        <TextLink
          testID={`${testID}-toggle`}
          label={expanded ? t('common.showLess') : t('common.showMore')}
          onPress={toggle}
          size="bodySmallBold"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={styles.toggle}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.bodySmall,
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  toggle: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});

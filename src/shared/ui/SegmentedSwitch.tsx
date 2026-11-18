/**
 * A single-choice segmented track: a grey track with one segment per option,
 * each its word and, when the caller gives one, its count, the chosen option
 * raised on the track.
 *
 * It is not a row of selector chips, so it never reads as a second row of the
 * chips above or below it. An option may carry the colour it is keyed by, drawn
 * as a small mark before its word. The options, counts and colours are the
 * caller's, so the switch counts and colours nothing itself.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/shared/app';
import * as haptics from '@/shared/ui/haptics';
import { pressedOpacity } from '@/shared/ui/pressFeedback';
import { PressTarget } from '@/shared/ui/PressTarget';
import {
  colors,
  controlHeight,
  darkColors,
  layout,
  raised,
  slopToMinTapTarget,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { composeAccessibilityLabel } from './accessibilityLabel';
import { DENSE_TEXT_SCALE } from './DenseText';
import { FitText } from './FitText';

export interface SegmentedSwitchOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, and spoken with it. */
  count?: number;
  /** The colour the segment is keyed by, drawn as a mark before its label. */
  mark?: string;
}

export interface SegmentedSwitchProps<T extends string> {
  value: T;
  options: readonly SegmentedSwitchOption<T>[];
  onChange: (value: T) => void;
  /** The track's id; each segment is `${testID}-${value}`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedSwitch<T extends string>({
  value,
  options,
  onChange,
  testID,
  style,
}: SegmentedSwitchProps<T>) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: palette.fillNeutral }, style]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const ink = selected ? palette.textPrimary : palette.textSecondary;
        return (
          <PressTarget
            key={option.value}
            testID={`${testID}-${option.value}`}
            accessibilityRole="tab"
            accessibilityLabel={composeAccessibilityLabel(option.label, option.count)}
            accessibilityState={{ selected }}
            hitSlop={SEGMENT_SLOP}
            fade={false}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              selected ? [{ backgroundColor: palette.surface }, raised('card', isDark)] : null,
              { opacity: pressedOpacity(pressed) },
            ]}
          >
            {option.mark !== undefined ? (
              <View
                testID={`${testID}-${option.value}-mark`}
                style={[styles.mark, { backgroundColor: option.mark }]}
              />
            ) : null}
            <FitText
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.label, { color: ink }]}
            >
              {option.label}
            </FitText>
            {option.count !== undefined ? (
              <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={[styles.count, { color: ink }]}>
                {option.count}
              </Text>
            ) : null}
          </PressTarget>
        );
      })}
    </View>
  );
}

const SEGMENT_SLOP = slopToMinTapTarget(controlHeight.chip);

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    padding: spacing.xxs,
    gap: spacing.xxs,
    borderRadius: layout.borderRadiusMd,
  },
  // Each segment grows from its own content rather than from a zero basis, so
  // inside a row, where the track sizes to its content, the words still fit.
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: controlHeight.chip,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    // Every segment carries the raised edge's width, so choosing one does not move the row.
    borderWidth: stroke.one,
    borderColor: 'transparent',
  },
  // The data-mark size, as a chip keys its series.
  mark: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusXs,
  },
  // The label gives way before the count, which never truncates.
  label: {
    ...typography.bodyCompactBold,
    flexShrink: 1,
  },
  count: {
    ...typography.caption,
  },
});

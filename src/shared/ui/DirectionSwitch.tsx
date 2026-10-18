/**
 * The switch between the two directions a section or route is ridden in.
 *
 * A grey segmented track with one segment per direction, each its word and how
 * many attempts it holds, the chosen one raised on the track. It is not a row
 * of selector chips, so it never reads as a second row of the plot toggle that
 * sits above it on the same card.
 *
 * The counts are the engine's and the colours the direction pair, both handed
 * in by the caller, so the switch counts and colours nothing itself. With
 * either direction empty there is nothing to switch between, and it draws
 * nothing.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

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

export type SwitchDirection = 'forward' | 'reverse';

const DIRECTIONS: readonly SwitchDirection[] = ['forward', 'reverse'];

const LABEL_KEYS = {
  forward: 'sections.forward',
  reverse: 'sections.reverse',
} as const;

export interface DirectionSwitchProps {
  value: SwitchDirection;
  /** Attempts per direction, as the engine counts them. */
  counts: Record<SwitchDirection, number>;
  /** The colour each direction is drawn in on the page. */
  marks: Record<SwitchDirection, string>;
  onChange: (direction: SwitchDirection) => void;
  /** The track's id; each segment is `${testID}-${direction}`. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function DirectionSwitch({
  value,
  counts,
  marks,
  onChange,
  testID,
  style,
}: DirectionSwitchProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;

  if (counts.forward <= 0 || counts.reverse <= 0) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: palette.fillNeutral }, style]}
    >
      {DIRECTIONS.map((direction) => {
        const selected = direction === value;
        const label = t(LABEL_KEYS[direction]);
        const count = counts[direction];
        const ink = selected ? palette.textPrimary : palette.textSecondary;
        return (
          <PressTarget
            key={direction}
            testID={`${testID}-${direction}`}
            accessibilityRole="tab"
            accessibilityLabel={composeAccessibilityLabel(label, count)}
            accessibilityState={{ selected }}
            hitSlop={SEGMENT_SLOP}
            fade={false}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(direction);
            }}
            style={({ pressed }) => [
              styles.segment,
              selected ? [{ backgroundColor: palette.surface }, raised('card', isDark)] : null,
              { opacity: pressedOpacity(pressed) },
            ]}
          >
            <View
              testID={`${testID}-${direction}-mark`}
              style={[styles.mark, { backgroundColor: marks[direction] }]}
            />
            <FitText
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.label, { color: ink }]}
            >
              {label}
            </FitText>
            <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={[styles.count, { color: ink }]}>
              {count}
            </Text>
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
  segment: {
    flex: 1,
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

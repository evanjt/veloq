/**
 * The app's card container.
 *
 * Every card drew its own radius, shadow and dark ground, so three cards on
 * one scroll had three looks. This is the one container: `flat` draws no
 * shadow, `raised` draws the card shadow, and both share one radius and one
 * dark surface. Content that runs to the edge takes `padding="none"`.
 *
 * The caller can lay it out and nothing else. Width, flex and self-alignment
 * apply to the container, direction, alignment and gap to its content. Background, radius, border and
 * shadow are not in the `style` type, and there is no margin: the parent stack
 * owns the spacing between cards.
 */

import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, shadows, spacing } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

export type CardVariant = 'flat' | 'raised';
export type CardPadding = 'none' | 'sm' | 'md';

export type CardLayoutStyle = Pick<
  ViewStyle,
  'width' | 'flex' | 'alignSelf' | 'flexDirection' | 'alignItems' | 'gap'
>;

interface CardBaseProps {
  variant: CardVariant;
  padding?: CardPadding;
  style?: CardLayoutStyle;
  testID?: string;
  children?: React.ReactNode;
}

export type CardProps =
  | (CardBaseProps & {
      onPress?: undefined;
      accessibilityLabel?: string;
      /** Names a static card for a screen reader, `summary` for a figure panel. */
      accessibilityRole?: 'summary';
    })
  | (CardBaseProps & {
      onPress: () => void;
      accessibilityLabel: string;
      accessibilityRole: 'button';
    });

const PADDING: Record<CardPadding, number | undefined> = {
  none: undefined,
  sm: spacing.sm,
  md: spacing.md,
};

export function Card({
  variant,
  padding = 'md',
  style,
  testID,
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole,
}: CardProps) {
  const { isDark } = useTheme();

  const ground: ViewStyle = {
    backgroundColor: isDark ? darkColors.surfaceCard : colors.surface,
    borderRadius: layout.borderRadius,
    ...(variant === 'raised'
      ? isDark
        ? { ...shadows.none, borderWidth: 1, borderColor: darkColors.border }
        : shadows.card
      : null),
  };

  const bodyStyle: ViewStyle =
    padding === 'none'
      ? { overflow: 'hidden', borderRadius: layout.borderRadius }
      : { padding: PADDING[padding] as number };

  const { flexDirection, alignItems, gap, ...outer } = style ?? {};
  const inner: ViewStyle = {};
  if (flexDirection !== undefined) inner.flexDirection = flexDirection;
  if (alignItems !== undefined) inner.alignItems = alignItems;
  if (gap !== undefined) inner.gap = gap;

  const body = (
    <View testID={testID ? `${testID}-body` : undefined} style={[styles.body, bodyStyle, inner]}>
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        android_ripple={pressRipple}
        style={pressable([ground, outer])}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={[ground, outer]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1 },
});

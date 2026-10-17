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
import { colors, darkColors, layout, shadows, spacing, stroke } from '@/theme';
import { CardHeader } from './CardHeader';
import { pressable, pressRipple } from './pressFeedback';
import { accessibleActions, type AccessibleAction } from './accessibleActions';

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
  /** The card's heading, drawn above the content in the card title role. */
  title?: string | undefined;
  /** A control or figure beside the title. */
  titleAccessory?: React.ReactNode;
  children?: React.ReactNode;
}

export type CardProps =
  | (CardBaseProps & {
      onPress?: undefined;
      actions?: undefined;
      accessibilityLabel?: string;
      accessibilityValue?: undefined;
      /** Names a static card for a screen reader, `summary` for a figure panel. */
      accessibilityRole?: 'summary';
    })
  | (CardBaseProps & {
      onPress: () => void;
      /**
       * Replaces every child's text for a screen reader, so it carries the
       * card's values as well as its name (`composeAccessibilityLabel`).
       */
      accessibilityLabel: string;
      /** The card's current value or state, read after its name. */
      accessibilityValue?: string | undefined;
      accessibilityRole: 'button';
      /**
       * What a screen reader offers beside the press. A press target nested in
       * the card, or a swipe or hold over it, is hidden inside the card's own
       * element, so it is offered here.
       */
      actions?: readonly AccessibleAction[] | undefined;
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
  title,
  titleAccessory,
  children,
  onPress,
  accessibilityLabel,
  accessibilityValue,
  accessibilityRole,
  actions,
}: CardProps) {
  const { isDark } = useTheme();

  const ground: ViewStyle = {
    backgroundColor: isDark ? darkColors.surfaceCard : colors.surface,
    borderRadius: layout.borderRadius,
    ...(variant === 'raised'
      ? isDark
        ? { ...shadows.none, borderWidth: stroke.one, borderColor: darkColors.border }
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
      {title != null && (
        <CardHeader
          title={title}
          accessory={titleAccessory}
          testID={testID ? `${testID}-header` : undefined}
        />
      )}
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
        {...accessibleActions(actions)}
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

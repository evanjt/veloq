/**
 * A link drawn as text: the one place a text takes a press.
 *
 * `TextLink` stands on its own, under a paragraph or beside a separator, and
 * is drawn at its line height. Hit slop lifts that line to the platform
 * minimum vertically only, so two links side by side never reach into each
 * other across the gap between them.
 *
 * `InlineLink` sits inside a sentence. It is a nested text and takes the
 * sentence's line, which is WCAG 2.5.8's inline exception, so it carries no
 * target of its own. `scripts/lint-tap-targets.mjs` refuses a text with
 * `onPress` anywhere but here.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  type AccessibilityState,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, darkColors, slopToMinTapTarget, spacing, typography } from '@/theme';

import { pressable, pressRipple } from './pressFeedback';

/** The two sizes a standalone link is drawn at. */
export type TextLinkSize = 'bodySmall' | 'caption';

const ICON_SIZE = 14;

const LINK_SLOP: Record<TextLinkSize, ReturnType<typeof slopToMinTapTarget>> = {
  bodySmall: slopToMinTapTarget(typography.bodySmall.lineHeight),
  caption: slopToMinTapTarget(typography.caption.lineHeight),
};

export interface TextLinkProps {
  label: string;
  onPress: () => void;
  size?: TextLinkSize;
  /** A glyph drawn beside the text, before it or after it. */
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconPosition?: 'leading' | 'trailing';
  /** A link by default; a press that changes this screen, such as a disclosure, is a button. */
  accessibilityRole?: 'link' | 'button';
  accessibilityState?: AccessibilityState;
  /** Outer spacing only. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TextLink({
  label,
  onPress,
  size = 'bodySmall',
  icon,
  iconPosition = 'leading',
  accessibilityRole = 'link',
  accessibilityState,
  style,
  testID,
}: TextLinkProps) {
  const { isDark } = useTheme();
  const tint = isDark ? darkColors.linkTeal : colors.linkTeal;
  const glyph = icon ? <MaterialCommunityIcons name={icon} size={ICON_SIZE} color={tint} /> : null;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      hitSlop={LINK_SLOP[size]}
      style={pressable([styles.link, { minHeight: typography[size].lineHeight }, style])}
      android_ripple={pressRipple}
    >
      {iconPosition === 'leading' && glyph}
      <Text style={[styles[size], styles.text, { color: tint }]}>{label}</Text>
      {iconPosition === 'trailing' && glyph}
    </Pressable>
  );
}

export interface InlineLinkProps {
  /** What a screen reader announces: the linked words themselves. */
  accessibilityLabel: string;
  onPress: () => void;
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

/** A link inside a sentence, taking the sentence's own line. */
export function InlineLink({ accessibilityLabel, onPress, children, style }: InlineLinkProps) {
  const { isDark } = useTheme();
  return (
    <Text
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      style={[styles.text, { color: isDark ? darkColors.linkTeal : colors.linkTeal }, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: {
    textDecorationLine: 'underline',
  },
  bodySmall: {
    ...typography.bodySmall,
  },
  caption: {
    ...typography.caption,
  },
});

/**
 * The icon-only form of `Button`.
 *
 * It is drawn in the button square of `controlHeight` whatever the glyph size,
 * or the small button's square where a row has no room for the full one,
 * and hit slop lifts that square to the platform minimum, so a small icon is
 * still a tap target without a large disc around it. The label is required in
 * the props type because an icon has no text for a screen reader to fall back
 * on. Variants and press feedback are `Button`'s own.
 *
 * A toggle passes `selected`: while on it fills `controlOn` under a white
 * glyph, the selected chip's look, whatever its variant, so a column of map
 * controls never shows a filled primary per active toggle. The glyph ink
 * belongs to the button too: `IconButton.Glyph` reads it, the secondary icon
 * ink on an unfilled ground and white on a filled one, `IconButton.Spinner`
 * draws a busy state in it, and a mark drawn by hand takes it from
 * `useIconButtonInk` or `iconButtonSkin`.
 */

import React, { createContext, useContext } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/shared/app';
import {
  colors,
  controlHeight,
  darkColors,
  gapBetweenTargets,
  iconSize,
  layout,
  opacity,
  slopToMinTapTarget,
  stroke,
} from '@/theme';

import { paint, selectedChipPaint, type ButtonVariant } from './Button';
import { pressedOpacity } from './pressFeedback';
import { PressTarget } from './PressTarget';
import { Spinner } from './Spinner';

export interface IconButtonProps {
  /** What a screen reader announces. Required: an icon has no text of its own. */
  accessibilityLabel: string;
  onPress?: () => void;
  onPressIn?: () => void;
  /** The glyph. It sizes itself, the target does not follow it. */
  children: React.ReactNode;
  variant?: ButtonVariant;
  /** A toggle's state: on fills the control on blue, and both states reach a screen reader. */
  selected?: boolean;
  disabled?: boolean;
  accessibilityState?: AccessibilityState;
  /** A button by default; a press that opens a web page is a link. */
  accessibilityRole?: 'button' | 'link';
  /** Drawn in the small button's square, still lifted to the tap-target minimum. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
}

export interface IconButtonSkin {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  /** The glyph's ink on that ground. */
  glyph: string;
}

/**
 * The ground, edge and glyph ink of an icon button. Selected, it is the
 * selected chip's fill and outline under its ink in every variant; otherwise
 * it is the variant's `Button` ground, under white when that ground is a fill
 * and the secondary icon ink when it is not.
 */
export function iconButtonSkin({
  variant = 'ghost',
  selected = false,
  isDark,
}: {
  variant?: ButtonVariant;
  selected?: boolean;
  isDark: boolean;
}): IconButtonSkin {
  const base = paint(variant, isDark);
  if (selected) {
    const on = selectedChipPaint(isDark);
    return {
      backgroundColor: on.fill,
      borderColor: on.outline,
      borderWidth: stroke.one,
      glyph: on.ink,
    };
  }
  const filled = variant === 'primary' || variant === 'destructive';
  return {
    backgroundColor: base.backgroundColor,
    borderColor: base.borderColor,
    borderWidth: base.borderWidth,
    glyph: filled ? colors.textOnFill : (isDark ? darkColors : colors).iconSecondary,
  };
}

const InkContext = createContext<string | null>(null);

/** The glyph ink of the icon button this sits in, for a spinner or a mark drawn by hand. */
export function useIconButtonInk(): string {
  const { isDark } = useTheme();
  return useContext(InkContext) ?? (isDark ? darkColors : colors).iconSecondary;
}

/** A glyph drawn in its icon button's ink. */
function IconButtonGlyph({
  name,
  size = iconSize.md,
}: {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  size?: number;
}) {
  return <MaterialCommunityIcons name={name} size={size} color={useIconButtonInk()} />;
}

/** A busy spinner drawn in its icon button's ink, in place of the glyph. */
function IconButtonSpinner({ testID }: { testID?: string }) {
  return <Spinner inControl testID={testID} color={useIconButtonInk()} />;
}

export function IconButton({
  accessibilityLabel,
  onPress,
  onPressIn,
  children,
  variant = 'ghost',
  selected,
  disabled = false,
  accessibilityState,
  accessibilityRole = 'button',
  compact = false,
  style,
  testID,
}: IconButtonProps) {
  const { isDark } = useTheme();
  const skin = iconButtonSkin({ variant, selected: selected === true, isDark });

  return (
    <PressTarget
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        ...accessibilityState,
        ...(selected === undefined ? {} : { selected }),
        disabled,
      }}
      hitSlop={compact ? COMPACT_SLOP : ICON_SLOP}
      disabled={disabled}
      fade={false}
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: disabled ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
        // The on state is the button's to draw, so a caller's own ground never hides it.
        selected === true && {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
        },
      ]}
    >
      <InkContext.Provider value={skin.glyph}>{children}</InkContext.Provider>
    </PressTarget>
  );
}

IconButton.Glyph = IconButtonGlyph;
IconButton.Spinner = IconButtonSpinner;

const ICON_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);
const COMPACT_SLOP = slopToMinTapTarget(controlHeight.buttonSm, controlHeight.buttonSm);

/** The gap a row of icon buttons keeps between them, so their hit slops never overlap. */
export const ICON_BUTTON_GAP = gapBetweenTargets(controlHeight.button);

/** The same gap for a row of compact icon buttons. */
export const COMPACT_ICON_BUTTON_GAP = gapBetweenTargets(controlHeight.buttonSm);

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    minWidth: controlHeight.button,
    minHeight: controlHeight.button,
    overflow: 'hidden',
  },
  compact: {
    minWidth: controlHeight.buttonSm,
    minHeight: controlHeight.buttonSm,
  },
});

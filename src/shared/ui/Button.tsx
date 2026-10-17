/**
 * The app's button, and the only one.
 *
 * There were three answers in the tree and the product screens used none of
 * them: 113 files rendered a `TouchableOpacity`, 55 a `Pressable`, and 124
 * distinct `StyleSheet` keys matching `button` were the variant list nobody had
 * written down.
 *
 * **One visual on both platforms, platform feedback underneath.** The idiom
 * rule takes the platform for navigation chrome and sheets and keeps the app's
 * own for what the screens draw, and a button is the second. So the shape, the
 * ground and the type are the app's, and what differs is the press, an opacity
 * fade on iOS against a Material ripple on Android, and the tap target, which
 * takes each platform's own minimum through `layout.minTapTarget`.
 *
 * **Drawn compact, reached through slop.** A button is drawn at its rung of
 * `controlHeight` and the rest of the platform minimum is hit slop, so the
 * target holds and a button bar does not read as a row of boxes.
 *
 * **The button owns its glyph.** A caller names the glyph and the button draws
 * it at the icon rung of its size, `iconSize.sm` beside the small label and
 * `iconSize.md` beside the medium one, in the label's own ink, so each variant
 * gets the right colour with no caller input and a control never draws two.
 *
 * Tokens only. No hex literal and no `fontSize` number, which is what makes
 * converting the eighty-odd call sites mechanical rather than a redesign.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { ChromeIcon, type ChromeRole } from '@/shared/ui/ChromeIcon';
import { DisclosureChevron } from '@/shared/ui/DisclosureChevron';
import * as haptics from '@/shared/ui/haptics';
import { pressRipple, pressedOpacity } from '@/shared/ui/pressFeedback';
import {
  colorWithOpacity,
  colors,
  controlHeight,
  darkColors,
  iconSize,
  ink as inkTone,
  inputBoundary,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { DENSE_TEXT_SCALE } from './DenseText';
import { FitText } from './FitText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

type MaterialGlyph = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * What sits beside a label. The button sizes and colours it; a caller only
 * names it.
 *
 * - A glyph name, drawn in the label's ink.
 * - `{ chrome }`, an action every app has, in the platform's own glyph.
 * - `{ name, ink }`, a glyph whose colour carries meaning of its own, such as
 *   a sport or a chart series. The call site says why.
 * - `{ spinner: true }`, work running behind a button that still takes a press,
 *   such as Cancel. A button whose press is refused meanwhile is `loading`.
 */
export type ButtonGlyph =
  | MaterialGlyph
  | { chrome: ChromeRole }
  | { name: MaterialGlyph; ink: string }
  | { spinner: true };

export interface ButtonProps {
  label: string;
  /** What a screen reader says when the label alone does not name the action. */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /**
   * The press opens a confirmation. A destructive button then fires no haptic of its own: the
   * confirm's accept does, once.
   */
  opensConfirm?: boolean;
  /**
   * Hides the label under a spinner and refuses the press. The label stays in the
   * layout, so the button keeps its width.
   */
  loading?: boolean;
  /**
   * The button opens and closes something in place, and this is whether it is
   * open. With no `icon` of its own it draws the disclosure chevron.
   */
  expanded?: boolean;
  /** Sits before the label, inside the same tap target. */
  icon?: ButtonGlyph;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  labelTestID?: string;
  /** The pressable, for a sheet that anchors to the control that opened it. */
  ref?: React.Ref<View>;
}

/** The ground, the border and the text, per variant and per theme. */
export function paint(variant: ButtonVariant, isDark: boolean) {
  const palette = isDark ? darkColors : colors;
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: palette.surface,
        // A control's edge is a mark rather than a divider, so it takes the field edge at 3:1.
        borderColor: isDark ? inputBoundary.dark : inputBoundary.light,
        borderWidth: stroke.one,
        color: palette.textPrimary,
      };
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        // A label with no ground of its own is text on the page, so it takes the accent's text role.
        color: palette.actionLink,
      };
    case 'destructive':
      return {
        // A deep red under white in both themes, so the destructive label never changes ink.
        backgroundColor: palette.dangerFill,
        borderColor: palette.dangerFill,
        borderWidth: 0,
        color: colors.textOnDark,
      };
    case 'primary':
    default:
      return {
        backgroundColor: palette.primary,
        borderColor: palette.primary,
        borderWidth: 0,
        color: colors.textOnPrimary,
      };
  }
}

/** The glyph rung beside each label size. */
const GLYPH_SIZE = {
  sm: iconSize.sm,
  md: iconSize.md,
} as const;

function Glyph({ glyph, size, color }: { glyph: ButtonGlyph; size: number; color: string }) {
  if (typeof glyph === 'string') {
    return <MaterialCommunityIcons name={glyph} size={size} color={color} />;
  }
  if ('chrome' in glyph) return <ChromeIcon name={glyph.chrome} size={size} color={color} />;
  if ('spinner' in glyph) return <ActivityIndicator size="small" color={color} />;
  return <MaterialCommunityIcons name={glyph.name} size={size} color={glyph.ink} />;
}

export function Button({
  label,
  accessibilityLabel,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  opensConfirm = false,
  expanded,
  icon,
  style,
  testID,
  labelTestID,
  ref,
}: ButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark);
  const inert = disabled || loading;
  const glyphSize = GLYPH_SIZE[size];
  // A destructive button acts on press, so it carries the weight of the act itself.
  const handlePress =
    variant === 'destructive' && !opensConfirm
      ? () => {
          haptics.medium();
          onPress();
        }
      : onPress;

  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled,
        busy: loading,
        ...(expanded !== undefined && { expanded }),
      }}
      hitSlop={BUTTON_SLOP[size]}
      android_ripple={inert ? undefined : pressRipple}
      disabled={inert}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        {
          backgroundColor: skin.backgroundColor,
          borderColor: skin.borderColor,
          borderWidth: skin.borderWidth,
          opacity: inert ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      <View
        testID={testID ? `${testID}-content` : undefined}
        style={[styles.row, loading && styles.hidden]}
      >
        {icon !== undefined ? (
          <Glyph glyph={icon} size={glyphSize} color={skin.color} />
        ) : expanded !== undefined ? (
          <DisclosureChevron expanded={expanded} size={glyphSize} color={skin.color} />
        ) : null}
        <Text
          testID={labelTestID ?? (testID && `${testID}-label`)}
          style={[
            size === 'sm' ? styles.labelSm : styles.labelMd,
            styles.label,
            { color: skin.color },
          ]}
        >
          {label}
        </Text>
      </View>
      {loading ? (
        <View
          testID={testID ? `${testID}-spinner-frame` : undefined}
          style={[StyleSheet.absoluteFill, styles.spinnerFrame]}
          pointerEvents="none"
        >
          <ActivityIndicator
            testID={testID ? `${testID}-spinner` : undefined}
            color={skin.color}
            size="small"
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export interface ToggleButtonProps {
  label: string;
  onPress: () => void;
  /** Drawn in the label's ink at the size's icon rung, as on `Button`. */
  icon?: ButtonGlyph;
  selected?: boolean;
  disabled?: boolean;
  size?: ButtonSize;
  /** The ground when selected, for an option that stands for a sport or a series. */
  fill?: string;
  /** The label on `fill`, which has to clear 4.5:1 on it. */
  ink?: string;
  /** A number after the label, drawn smaller in the label's ink, such as how many items the option holds. */
  count?: number;
  /** What a tap does, when the label alone does not say it. Defaults to the label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The app's selector chip: one option among a few, the chosen one filled.
 *
 * Every selector draws this one chip, whether it sits in a filter row, a
 * section page's plot switch or a settings row, so a row of them reads as one
 * control. The chosen chip is a solid fill against a faint wash, a step in
 * lightness as well as in hue, so the state survives greyscale and colour
 * blindness, and it is on `accessibilityState.selected` so a screen reader
 * reads it at all. Colour alone is not a state.
 */
export function ToggleButton({
  label,
  onPress,
  icon,
  selected = false,
  disabled = false,
  size = 'sm',
  fill,
  ink,
  count,
  accessibilityLabel,
  style,
  testID,
}: ToggleButtonProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const labelInk = selected ? (ink ?? colors.textOnPrimary) : palette.textSecondary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      hitSlop={CHIP_SLOP[size]}
      android_ripple={disabled ? undefined : pressRipple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        size === 'sm' ? styles.chipSm : styles.chipMd,
        {
          backgroundColor: selected ? (fill ?? palette.primary) : chipWash(isDark),
          opacity: disabled ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon !== undefined ? (
          <Glyph glyph={icon} size={GLYPH_SIZE[size]} color={labelInk} />
        ) : null}
        <FitText
          maxFontSizeMultiplier={DENSE_TEXT_SCALE}
          testID={testID ? `${testID}-label` : undefined}
          style={[styles.chipLabel, { color: labelInk }]}
        >
          {label}
          {count !== undefined && (
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              testID={testID ? `${testID}-count` : undefined}
              style={[styles.chipCount, { color: labelInk }]}
            >
              {' '}
              {count}
            </Text>
          )}
        </FitText>
      </View>
    </Pressable>
  );
}

/**
 * The ground of a chip that is not chosen, under a `textSecondary` label. In
 * dark, white at 0.15 over `surfaceCard` lifted it until the label read
 * 3.78:1. White at 0.05 keeps the selected blue 3.16:1 from it on `surface`,
 * where 0.08 left 2.89:1, so the chosen chip still steps in lightness.
 */
function chipWash(isDark: boolean): string {
  return isDark ? opacity.overlayDark.light : colorWithOpacity(inkTone.black, 0.08);
}

export interface ToggleButtonRowProps<T extends string> {
  options: readonly { value: T; label: string; testID?: string }[];
  value: T;
  onValueChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

/** A row of `ToggleButton`, one per option, with exactly one selected. */
export function ToggleButtonRow<T extends string>({
  options,
  value,
  onValueChange,
  style,
}: ToggleButtonRowProps<T>) {
  return (
    <View style={[styles.toggleRow, style]}>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          {...(option.testID && { testID: option.testID })}
          label={option.label}
          selected={option.value === value}
          onPress={() => onValueChange(option.value)}
          style={styles.toggleCell}
        />
      ))}
    </View>
  );
}

const BUTTON_HEIGHT = {
  sm: controlHeight.buttonSm,
  md: controlHeight.button,
} as const;
const CHIP_HEIGHT = {
  sm: controlHeight.chip,
  md: controlHeight.button,
} as const;
const BUTTON_SLOP = {
  sm: slopToMinTapTarget(BUTTON_HEIGHT.sm),
  md: slopToMinTapTarget(BUTTON_HEIGHT.md),
} as const;
const CHIP_SLOP = {
  sm: slopToMinTapTarget(CHIP_HEIGHT.sm),
  md: slopToMinTapTarget(CHIP_HEIGHT.md),
} as const;

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleCell: {
    flex: 1,
  },
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  sm: {
    minHeight: BUTTON_HEIGHT.sm,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
  },
  md: {
    minHeight: BUTTON_HEIGHT.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  // Hidden rather than unmounted, so a loading button measures what an idle one does.
  hidden: {
    opacity: 0,
  },
  spinnerFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A label wraps and the button grows at large text sizes rather than cutting
  // its words; shrinking inside the row is what lets it wrap beside an icon.
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
  // Both labels are semibold, so a small button reads as a smaller copy of the medium one.
  labelSm: typography.bodySmallBold,
  labelMd: typography.bodyBold,
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    gap: spacing.xs,
  },
  chipSm: {
    minHeight: CHIP_HEIGHT.sm,
    paddingHorizontal: spacing.smPlus,
  },
  chipMd: {
    minHeight: CHIP_HEIGHT.md,
    paddingHorizontal: spacing.md,
  },
  chipLabel: {
    ...typography.bodyCompact,
    fontWeight: '600',
  },
  chipCount: {
    ...typography.caption,
  },
});

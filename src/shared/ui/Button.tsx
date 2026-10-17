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
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { useButtonShapes } from '@/shared/ui/buttonShapes';
import { ChromeIcon, type ChromeRole } from '@/shared/ui/ChromeIcon';
import { DisclosureChevron } from '@/shared/ui/DisclosureChevron';
import * as haptics from '@/shared/ui/haptics';
import { pressRipple, pressedOpacity } from '@/shared/ui/pressFeedback';
import {
  colors,
  controlHeight,
  darkColors,
  iconSize,
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
  /**
   * The button opens a list of choices and reads the current one, so its
   * chevron trails the label as a menu's does rather than leading it.
   */
  opensMenu?: boolean;
  /** Sits before the label, inside the same tap target. */
  icon?: ButtonGlyph;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  labelTestID?: string;
  /** The pressable, for a sheet that anchors to the control that opened it. */
  ref?: React.Ref<View>;
}

/**
 * The ground, the border and the text, per variant and per theme. With Button
 * Shapes on, a ghost button takes the secondary edge, since it has no ground to
 * read as a control.
 */
export function paint(variant: ButtonVariant, isDark: boolean, shapes = false) {
  const palette = isDark ? darkColors : colors;
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: palette.surface,
        // A control's edge is a mark rather than a divider, so it takes the control edge at 3:1.
        borderColor: palette.controlBoundary,
        borderWidth: stroke.one,
        color: palette.textPrimary,
      };
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        // The edge is always there at its width, so turning the setting on moves no layout.
        borderColor: shapes ? palette.controlBoundary : 'transparent',
        borderWidth: stroke.one,
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
  opensMenu = false,
  icon,
  style,
  testID,
  labelTestID,
  ref,
}: ButtonProps) {
  const { isDark } = useTheme();
  const skin = paint(variant, isDark, useButtonShapes());
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
        ) : expanded !== undefined && !opensMenu ? (
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
        {opensMenu ? (
          <DisclosureChevron expanded={!!expanded} size={glyphSize} color={skin.color} />
        ) : null}
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

/** A selected chip's own ground and the label set on it. */
export interface ChipAccent {
  fill: string;
  ink: string;
}

export interface ToggleButtonProps {
  label: string;
  onPress: () => void;
  /** Drawn in the label's ink at the size's icon rung, as on `Button`. */
  icon?: ButtonGlyph;
  selected?: boolean;
  disabled?: boolean;
  size?: ButtonSize;
  /**
   * The ground and label when selected, for an exception to the selected
   * colours. They come as a pair, so a fill never takes an ink chosen for
   * another ground; the ink has to clear 4.5:1 on the fill.
   */
  accent?: ChipAccent;
  /** A leading dot in this colour, in both states, for an option that stands for a sport or a series. */
  mark?: string;
  /** A number after the label, drawn smaller in the label's ink, such as how many items the option holds. */
  count?: number;
  /**
   * Unselected, the chip carries the neutral control outline, for an option set apart from its
   * neighbours by a key beside the row. Selected, it is the plain selected chip.
   */
  outlined?: boolean;
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
 * control. The chosen chip is filled in `controlOn` against the neutral fill
 * and outlined in `focusRing`, the selected outline. In light the fill alone
 * steps 5:1 or more from the neutral fill; in dark it steps under 3:1 on a
 * card, so the outline is the cue that survives greyscale and colour
 * blindness. Every chip carries the same border width, so choosing one does
 * not move the row. It is on `accessibilityState.selected` so a screen reader
 * reads it at all. Colour alone is not a state.
 *
 * A press that chooses an unselected chip ticks the `selection` haptic; a press on the chosen one
 * changes nothing and stays still.
 */
export function ToggleButton({
  label,
  onPress,
  icon,
  selected = false,
  disabled = false,
  size = 'sm',
  accent,
  mark,
  count,
  outlined = false,
  accessibilityLabel,
  style,
  testID,
}: ToggleButtonProps) {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const labelInk = selected ? (accent?.ink ?? colors.textOnPrimary) : palette.textSecondary;
  const handlePress = selected
    ? onPress
    : () => {
        haptics.selection();
        onPress();
      };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      hitSlop={CHIP_SLOP[size]}
      android_ripple={disabled ? undefined : pressRipple}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.chip,
        size === 'sm' ? styles.chipSm : styles.chipMd,
        {
          backgroundColor: selected ? (accent?.fill ?? palette.controlOn) : palette.fillNeutral,
          borderColor: selected
            ? (accent?.fill ?? palette.focusRing)
            : outlined
              ? palette.controlBoundary
              : 'transparent',
          opacity: disabled ? opacity.disabled : pressedOpacity(pressed),
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {mark !== undefined ? (
          <View
            testID={testID ? `${testID}-mark` : undefined}
            style={[styles.chipMark, { backgroundColor: mark }]}
          />
        ) : null}
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

export interface ToggleButtonRowOption<T extends string> {
  value: T;
  label: string;
  testID?: string;
  /** A leading dot in the series colour, for an option that stands for a series. */
  mark?: string;
  /** The selected chip's own fill and the ink set on it, always as a pair. */
  accent?: ChipAccent;
}

export interface ToggleButtonRowProps<T extends string> {
  options: readonly ToggleButtonRowOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /**
   * `fill` shares the width equally between the chips, for two or three short options that
   * belong side by side. `hug` sizes each chip to its label and scrolls the row sideways when
   * the chips are wider than it, so no chip is clipped and no label is cut.
   */
  layout?: 'fill' | 'hug';
  style?: StyleProp<ViewStyle>;
}

/**
 * A row of `ToggleButton`, one per option, with exactly one selected. A press on the chosen
 * option reports nothing, since nothing changed.
 */
export function ToggleButtonRow<T extends string>({
  options,
  value,
  onValueChange,
  layout: rowLayout = 'fill',
  style,
}: ToggleButtonRowProps<T>) {
  const chips = options.map((option) => (
    <ToggleButton
      key={option.value}
      {...(option.testID && { testID: option.testID })}
      label={option.label}
      selected={option.value === value}
      {...(option.mark && { mark: option.mark })}
      {...(option.accent && { accent: option.accent })}
      onPress={() => {
        if (option.value !== value) onValueChange(option.value);
      }}
      {...(rowLayout === 'fill' && { style: styles.toggleCell })}
    />
  ));

  if (rowLayout === 'hug') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={styles.toggleRow}
      >
        {chips}
      </ScrollView>
    );
  }
  return <View style={[styles.toggleRow, style]}>{chips}</View>;
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
  // Adjacent small targets keep 8 pt between their drawn edges.
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
    borderWidth: stroke.one,
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
    ...typography.bodyCompactBold,
  },
  // The data-mark size, so a chip keys its series as a legend does.
  chipMark: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusXs,
  },
  chipCount: {
    ...typography.caption,
  },
});

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, opacity, spacing } from '@/theme';
import { pressable, pressRipple } from './pressFeedback';

interface RowBaseProps {
  children: React.ReactNode;
  testID?: string | undefined;
  /** Greys a pressable row and stops its press. */
  disabled?: boolean | undefined;
  /**
   * A control at the trailing edge, such as an info button. On a pressable row it
   * sits beside the row's target rather than inside it, so a screen reader reaches
   * the row and the accessory as two controls.
   */
  accessory?: React.ReactNode;
  /**
   * `row` pads the row's own edges, for a row that is the full width of its
   * screen or card. `none` leaves them to a container that already pads, such as
   * a list inside a card.
   */
  inset?: 'row' | 'none' | undefined;
}

/**
 * What pressing a row does. `navigate` opens another screen or sheet and draws
 * the disclosure chevron; `external` leaves the app for a web page, is announced
 * as a link and draws the open-in-new glyph; `act` runs something where the row
 * stands and draws none, so a destructive row is marked by its colour and words
 * alone.
 */
export type RowBehaviour = 'navigate' | 'external' | 'act';

export type RowProps =
  | (RowBaseProps & {
      onPress?: undefined;
      accessibilityLabel?: undefined;
      accessibilityValue?: undefined;
      busy?: undefined;
      behaviour?: undefined;
    })
  | (RowBaseProps & {
      onPress: () => void;
      /**
       * Replaces everything the row draws for a screen reader, so it carries the
       * row's values as well as its name (`composeAccessibilityLabel`).
       */
      accessibilityLabel: string;
      /** The row's current value or state, read after its name. */
      accessibilityValue?: string | undefined;
      /** The row's own action is running. */
      busy?: boolean | undefined;
      behaviour: RowBehaviour;
    });

export function Row({
  children,
  testID,
  onPress,
  accessibilityLabel,
  accessibilityValue,
  disabled,
  accessory,
  behaviour,
  busy,
  inset = 'row',
}: RowProps) {
  const { isDark } = useTheme();
  const glyphColour = isDark ? darkColors.textSecondary : colors.textSecondary;

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, inset === 'none' && styles.flush]}>
        {children}
        {accessory}
      </View>
    );
  }

  const target = (
    <Pressable
      testID={testID}
      accessibilityRole={behaviour === 'external' ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
      accessibilityState={
        disabled || busy ? { disabled: !!disabled, ...(busy && { busy: true }) } : undefined
      }
      onPress={onPress}
      disabled={disabled}
      android_ripple={pressRipple}
      style={pressable([
        styles.row,
        inset === 'none' && styles.flush,
        accessory != null && styles.besideAccessory,
        disabled && styles.disabled,
      ])}
    >
      {children}
      {behaviour === 'navigate' ? (
        <MaterialCommunityIcons
          testID="row-chevron"
          name="chevron-right"
          size={20}
          color={glyphColour}
        />
      ) : behaviour === 'external' ? (
        <MaterialCommunityIcons
          testID="row-external"
          name="open-in-new"
          size={18}
          color={glyphColour}
        />
      ) : null}
    </Pressable>
  );

  if (accessory == null) return target;

  return (
    <View style={styles.withAccessory}>
      {target}
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: layout.minTapTarget,
  },
  flush: {
    paddingHorizontal: 0,
  },
  besideAccessory: {
    flex: 1,
    paddingRight: 0,
  },
  withAccessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});

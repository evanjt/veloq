/**
 * One number when the data is one number: a value with its unit, the label that
 * names it, an optional change and a caption.
 *
 * The value is a standalone figure that never updates in place, so it draws the
 * stat role with proportional digits. A live readout keeps the tabular role and is
 * not a tile. A tile sits on a dense surface, a grid of fixed columns, so every line
 * takes the dense cap and wraps rather than truncating.
 */

import React from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';
import { useTheme } from '@/shared/app';
import {
  spacing,
  themedStyles,
  typography,
  verdictColor,
  type Palette,
  type VerdictRung,
} from '@/theme';
import { composeAccessibilityLabel } from './accessibilityLabel';
import { DenseText } from './DenseText';
import { pressable, pressRipple } from './pressFeedback';

/**
 * A change beside the value. The glyph is the arrow or sign the move is drawn
 * with and `spoken` is the move in words, so a tone is never the only carrier.
 */
export interface StatTileDelta {
  glyph: string;
  /** The change as printed, its unit included, when there is a figure for it. */
  text?: string | undefined;
  tone: VerdictRung;
  spoken: string;
}

export type StatTileSize = 'md' | 'lg';

/** `stacked` puts the value over its label, `inline` sets them on one baseline. */
export type StatTileLayout = 'stacked' | 'inline';

export interface StatTileProps {
  label: string;
  /** The value as the engine's formatter printed it; the tile derives nothing. */
  value: string | number;
  unit?: string | undefined;
  delta?: StatTileDelta | undefined;
  caption?: string | undefined;
  size?: StatTileSize;
  layout?: StatTileLayout;
  align?: 'start' | 'center';
  /** A text-grade colour the value is keyed to, such as a sport's; the primary text otherwise. */
  valueColor?: string | undefined;
  /** The tile is one button, and its label is drawn as the action. */
  onPress?: (() => void) | undefined;
  disabled?: boolean;
  /** Replaces the label spoken from the tile's own parts. */
  accessibilityLabel?: string | undefined;
  /**
   * False inside a parent that is already one element and speaks the tile, so the
   * tile is not a second stop for a screen reader.
   */
  accessible?: boolean;
  testID?: string | undefined;
}

const VALUE_ROLE: Record<StatTileSize, TextStyle> = {
  md: typography.statsValue,
  lg: typography.statsValueLarge,
};

/** The stat role with its figure variant switched off and every other attribute kept. */
function proportionalFigures(role: TextStyle): TextStyle {
  const { fontVariant: _tabular, ...rest } = role;
  return rest;
}

function spokenDelta(delta: StatTileDelta): string {
  return composeAccessibilityLabel(delta.spoken, delta.text);
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  caption,
  size = 'md',
  layout = 'stacked',
  align = 'start',
  valueColor,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessible = true,
  testID,
}: StatTileProps) {
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const isAction = onPress !== undefined && !disabled;
  const centred = align === 'center';
  const printedValue = unit ? `${value} ${unit}` : String(value);
  const spoken =
    accessibilityLabel ??
    composeAccessibilityLabel(label, printedValue, delta && spokenDelta(delta), caption);

  const valueLine = (
    <View style={[styles.valueRow, centred && styles.centredRow]}>
      <DenseText
        testID={testID ? `${testID}-value` : undefined}
        style={[styles.value, sizeStyles[size], valueColor !== undefined && { color: valueColor }]}
      >
        {value}
        {unit ? <DenseText style={styles.unit}> {unit}</DenseText> : null}
      </DenseText>
      {delta ? (
        <DenseText
          testID={testID ? `${testID}-delta` : undefined}
          accessibilityLabel={spokenDelta(delta)}
          style={[styles.delta, { color: verdictColor(delta.tone, isDark) }]}
        >
          {delta.text ? `${delta.glyph} ${delta.text}` : delta.glyph}
        </DenseText>
      ) : null}
    </View>
  );
  const labelLine = (
    <DenseText
      style={[
        styles.label,
        layout === 'stacked' && styles.stackedLabel,
        centred && styles.centredText,
        isAction && styles.actionLabel,
      ]}
    >
      {label}
    </DenseText>
  );
  const body = (
    <>
      {layout === 'inline' ? (
        <View style={styles.inlineRow}>
          {valueLine}
          {labelLine}
        </View>
      ) : (
        <>
          {valueLine}
          {labelLine}
        </>
      )}
      {caption ? (
        <DenseText style={[styles.caption, centred && styles.centredText]}>{caption}</DenseText>
      ) : null}
    </>
  );
  const frame = [styles.tile, centred && styles.centred];

  if (onPress !== undefined) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={pressable(frame)}
        android_ripple={pressRipple}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View
      testID={testID}
      accessible={accessible}
      accessibilityLabel={accessible ? spoken : undefined}
      style={frame}
    >
      {body}
    </View>
  );
}

const sizeStyles = StyleSheet.create({
  md: proportionalFigures(VALUE_ROLE.md),
  lg: proportionalFigures(VALUE_ROLE.lg),
});

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    tile: {},
    centred: {
      alignItems: 'center',
    },
    valueRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: spacing.xs,
    },
    centredRow: {
      justifyContent: 'center',
    },
    inlineRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: spacing.xs,
    },
    value: {
      color: palette.textPrimary,
    },
    unit: {
      ...typography.captionBold,
      color: palette.textSecondary,
    },
    delta: {
      ...typography.captionBold,
    },
    label: {
      ...typography.statsLabel,
      color: palette.textSecondary,
    },
    stackedLabel: {
      marginTop: spacing.xxs,
    },
    actionLabel: {
      color: palette.actionLink,
    },
    centredText: {
      textAlign: 'center',
    },
    caption: {
      ...typography.caption,
      color: palette.textSecondary,
      marginTop: spacing.xxs,
    },
  });

/**
 * The key to what a map's colours mean. `MapKey` is the card that sits over the
 * map; its rows also sit inside a menu that is already a card.
 *
 * - `MapKeySwatch`: one colour, or a run of colours, beside what it stands for,
 *   optionally with the glyph the map draws along that line.
 * - `MapKeyRamp`: a continuous scale, with its two ends named or its values
 *   ticked where they fall along it.
 */

import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';

import { Icon, type IconName } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize, raised, spacing, typography, layout } from '@/theme';

/** A row's swatch, the 16 by 4 bar the guide draws for a line. */
const SWATCH_WIDTH = 16;
const SWATCH_HEIGHT = 4;
/** Width of a ramp, fixed so a tick lands at its share of the scale. */
const RAMP_WIDTH = 160;
/** Room a tick's label is centred in. */
const TICK_WIDTH = 40;

export function MapKey({
  isDark,
  style,
  testID,
  children,
}: {
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: (isDark ? darkColors : colors).surfaceRaised },
        raised('mapOverlay', isDark),
        style,
      ]}
      testID={testID}
      pointerEvents="none"
    >
      {children}
    </View>
  );
}

export function MapKeySwatch({
  swatch,
  shape = 'line',
  glyph,
  label,
  isDark,
  testID,
}: {
  /** One colour, or several drawn side by side as one swatch. */
  swatch: string | readonly string[];
  /** A line for a drawn line, a dot for a point. */
  shape?: 'line' | 'dot';
  /** A symbol the map draws along the line, drawn over a single-colour line swatch. */
  glyph?: { name: IconName; color: string } | undefined;
  label: string;
  isDark: boolean;
  testID?: string | undefined;
}) {
  const runs = typeof swatch === 'string' ? [swatch] : swatch;
  return (
    <View style={styles.row} testID={testID}>
      {runs.length === 1 && glyph ? (
        <View testID="map-key-swatch" style={styles.glyphSwatch}>
          <View style={[styles.line, { backgroundColor: runs[0] }]} />
          <Icon
            name={glyph.name}
            size={iconSize.xs}
            color={glyph.color}
            style={styles.glyph}
            testID="map-key-swatch-glyph"
          />
        </View>
      ) : runs.length === 1 ? (
        <View
          testID="map-key-swatch"
          style={[shape === 'dot' ? styles.dot : styles.line, { backgroundColor: runs[0] }]}
        />
      ) : (
        <View testID="map-key-swatch" style={[styles.line, styles.runs]}>
          {runs.map((colour, i) => (
            <View key={i} style={[styles.step, { backgroundColor: colour }]} />
          ))}
        </View>
      )}
      <Text style={[styles.text, isDark && styles.textDark]}>{label}</Text>
    </View>
  );
}

export function MapKeyRamp({
  ramp,
  ends,
  ticks,
  isDark,
  testID,
}: {
  /** The scale's colours, evenly spaced from one end to the other. */
  ramp: readonly string[];
  /** What the two ends stand for. */
  ends?: readonly [string, string];
  /** Values named where they fall along the scale, `at` from 0 to 1. */
  ticks?: readonly { at: number; label: string }[];
  isDark: boolean;
  testID?: string | undefined;
}) {
  const textStyle = [styles.text, isDark && styles.textDark];
  return (
    <View style={styles.ramp} testID={testID}>
      <View style={styles.rampBar}>
        {ramp.map((colour, i) => (
          <View
            key={i}
            testID="map-key-ramp-step"
            style={[styles.step, { backgroundColor: colour }]}
          />
        ))}
      </View>
      {ticks ? (
        <View style={styles.ticks}>
          {ticks.map(({ at, label }) => (
            <View
              key={at}
              style={[
                styles.tick,
                {
                  left: Math.min(
                    RAMP_WIDTH - TICK_WIDTH,
                    Math.max(0, at * RAMP_WIDTH - TICK_WIDTH / 2)
                  ),
                },
              ]}
            >
              <Text style={[textStyle, styles.tickText]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {ends ? (
        <View style={styles.ends}>
          <Text style={[textStyle, styles.endText]}>{ends[0]}</Text>
          <Text style={[textStyle, styles.endText, styles.endTextLast]}>{ends[1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.sm,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
    borderRadius: layout.borderRadiusMd,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  line: {
    width: SWATCH_WIDTH,
    height: SWATCH_HEIGHT,
    borderRadius: layout.borderRadiusFull,
  },
  glyphSwatch: {
    width: SWATCH_WIDTH,
    height: iconSize.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    position: 'absolute',
  },
  runs: {
    width: 28,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: layout.borderRadiusFull,
  },
  ramp: {
    width: RAMP_WIDTH,
    gap: spacing.xxs,
  },
  rampBar: {
    height: 6,
    flexDirection: 'row',
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
  },
  step: {
    flex: 1,
  },
  ticks: {
    height: typography.caption.lineHeight,
  },
  tick: {
    position: 'absolute',
    width: TICK_WIDTH,
  },
  tickText: {
    textAlign: 'center',
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  endText: {
    flexShrink: 1,
  },
  endTextLast: {
    textAlign: 'right',
  },
  text: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});

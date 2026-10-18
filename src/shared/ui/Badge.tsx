/**
 * The one badge: a count, a record, a change or a status, as a small pill.
 *
 * A tone names a meaning rather than a colour, and every fill names its own
 * ink: the deep fills take `textOnFill`, the bright ones `textOnBright`. Each
 * pair holds 4.5:1 for the text and 3:1 for the fill on every surface, in both
 * themes. The text is short, a count, a record word or a signed change of five
 * characters or fewer; a longer result belongs in the content beside it.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { Icon, type IconName } from './Icon';
import { DENSE_TEXT_SCALE } from './DenseText';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  type VerdictRung,
} from '@/theme';

export const BADGE_TONES = [
  'neutral',
  'count',
  'record',
  'positive',
  'warning',
  'negative',
] as const;

export type BadgeTone = (typeof BADGE_TONES)[number];

export type BadgeSize = 'md' | 'sm';

type Palette = typeof colors | typeof darkColors;

/** Each tone's fill and the ink on it, read from the theme's roles. */
const TONE_PAINT: Record<
  BadgeTone,
  (p: Palette, isDark: boolean) => { fill: string; ink: string }
> = {
  count: (p) => ({ fill: p.controlOn, ink: p.textOnFill }),
  record: (p) => ({ fill: p.achievement, ink: p.textOnBright }),
  positive: (p) => ({ fill: p.successFill, ink: p.textOnBright }),
  warning: (p) => ({ fill: p.warningFill, ink: p.textOnBright }),
  negative: (p) => ({ fill: p.dangerFill, ink: p.textOnFill }),
  // The boundary grey is a mark at 3:1 in both themes; it is deep in the
  // light theme and bright in the dark one, so the ink follows.
  neutral: (p, isDark) => ({
    fill: p.controlBoundary,
    ink: isDark ? p.textOnBright : p.textOnFill,
  }),
};

/** The fill a tone draws and the ink on it, in one theme. */
export function badgePaint(tone: BadgeTone, isDark: boolean): { fill: string; ink: string } {
  return TONE_PAINT[tone](isDark ? darkColors : colors, isDark);
}

/** The tone a judged change draws in, by the rung of the verdict ladder it sits on. */
export function verdictTone(rung: VerdictRung): BadgeTone {
  return rung === 'caution' ? 'warning' : rung;
}

/** The height of each size; the badge grows past it when the text is scaled up. */
const HEIGHT: Record<BadgeSize, number> = { md: 20, sm: 16 };

interface BadgeProps {
  tone: BadgeTone;
  /** What the badge shows: a count, a record word, or a signed change. */
  text: string | number;
  /** What the badge means when spoken, such as "3 new"; the text when unset. */
  label?: string | undefined;
  size?: BadgeSize;
  /** A leading glyph, drawn at the extra-small icon size in the ink. */
  icon?: IconName | undefined;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({ tone, text, label, size = 'md', icon, isDark, style, testID }: BadgeProps) {
  const { fill, ink } = badgePaint(tone, isDark);
  const height = HEIGHT[size];
  return (
    <View
      accessible
      accessibilityLabel={label ?? String(text)}
      style={[
        styles.badge,
        size === 'sm' ? styles.sm : styles.md,
        { minHeight: height, minWidth: height, backgroundColor: fill },
        style,
      ]}
      testID={testID}
    >
      {icon ? (
        <Icon
          name={icon}
          size={iconSize.xs}
          color={ink}
          testID={testID ? `${testID}-glyph` : undefined}
        />
      ) : null}
      <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={[styles.text, { color: ink }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xxs,
    borderRadius: layout.borderRadiusFull,
  },
  md: {
    paddingHorizontal: spacing.xsPlus,
  },
  sm: {
    paddingHorizontal: spacing.xs,
  },
  text: {
    ...typography.badge,
  },
});

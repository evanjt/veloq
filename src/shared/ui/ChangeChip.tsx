import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { Icon } from './Icon';
import { DENSE_TEXT_SCALE } from './DenseText';
import { iconSize, layout, spacing, typography, verdictColor, verdictFill } from '@/theme';
import {
  verdictIcon,
  verdictRung,
  type TrendDirection,
  type TrendVerdict,
} from '@/shared/format/trend';

interface ChangeChipProps {
  /** The change as printed, its unit included. */
  text: string;
  /** The judged move; without one the chip is drawn neutral, since no sign is read as a verdict. */
  trend?: { direction: TrendDirection; verdict: TrendVerdict } | undefined;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A change stated in its verdict's rung: the glyph and the text on that rung's fill. */
export function ChangeChip({ text, trend, isDark, style, testID }: ChangeChipProps) {
  const rung = trend ? verdictRung(trend.verdict) : 'neutral';
  const glyph = trend ? verdictIcon(trend.verdict, trend.direction) : 'minus';
  const color = verdictColor(rung, isDark);
  return (
    <View
      style={[styles.chip, { backgroundColor: verdictFill(rung, isDark) }, style]}
      testID={testID}
    >
      <Icon name={glyph} size={iconSize.md} color={color} />
      <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={[styles.text, { color }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusMd,
    gap: spacing.xs,
  },
  text: {
    ...typography.pillValue,
  },
});

import { StyleSheet } from 'react-native';
import { colors, colorWithOpacity, darkColors, ink, opacity } from './colors';
import { layout, spacing } from './spacing';
import { typography } from './typography';

/** The one tick and axis label role: a 12px caption in tabular figures. */
const axisText = {
  ...typography.caption,
  fontVariant: ['tabular-nums' as const],
  color: colors.textSecondary,
};

export const chartStyles = StyleSheet.create({
  /** Common chart container: flex: 1 + position: relative */
  chartWrapper: {
    flex: 1,
    position: 'relative' as const,
  },

  /** Every axis and tick label, set in the gutter or strip beside the plot. */
  axisLabel: axisText,
  axisLabelDark: {
    color: darkColors.textSecondary,
  },

  /** An axis label that has to sit over the plot, on a chip that keeps it readable. */
  axisLabelOnData: {
    ...axisText,
    backgroundColor: colorWithOpacity(ink.white, opacity.pressed),
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden' as const,
  },
  axisLabelOnDataDark: {
    color: darkColors.textSecondary,
    backgroundColor: darkColors.surfaceOverlay,
  },

  /** Dark mode text override */
  textDark: {
    color: darkColors.textSecondary,
  },
});

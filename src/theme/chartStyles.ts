import { StyleSheet } from 'react-native';
import { colors, colorWithOpacity, darkColors, ink, opacity } from './colors';
import { layout, spacing } from './spacing';
import { typography } from './typography';

/** The one chart text role: a 12px caption in tabular figures, never below it. */
const chartText = {
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

  /** Every tick, axis title, unit and legend label a chart sets. */
  chartLabel: chartText,
  chartLabelDark: {
    color: darkColors.textSecondary,
  },

  /**
   * A lane title or a direct label, which names what it sits beside. Text never wears the
   * series colour: a dot, swatch or fill beside it keys the series.
   */
  chartLabelStrong: {
    ...chartText,
    color: colors.textPrimary,
  },
  chartLabelStrongDark: {
    color: darkColors.textPrimary,
  },

  /** A label that has to sit over the plot, on a chip that keeps it readable. */
  chartLabelOnData: {
    ...chartText,
    backgroundColor: colorWithOpacity(ink.white, opacity.pressed),
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden' as const,
  },
  chartLabelOnDataDark: {
    color: darkColors.textSecondary,
    backgroundColor: darkColors.surfaceRaised,
  },

  /** Dark mode text override */
  textDark: {
    color: darkColors.textSecondary,
  },
});

import { StyleSheet } from 'react-native';
import { colors, darkColors } from './colors';
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

  /**
   * The box holding a plot and every label, gutter and crosshair placed against it. A canvas
   * draws in physical pixels and never mirrors, so the views laid out against it are pinned left
   * to right too: under a right-to-left layout the axis would otherwise run the other way from
   * the marks it labels.
   */
  plotDirection: {
    direction: 'ltr' as const,
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

  /** Dark mode text override */
  textDark: {
    color: darkColors.textSecondary,
  },
});

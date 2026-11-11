import { StyleSheet } from 'react-native';
import { colors, darkColors } from './colors';
import { typography } from './typography';

/**
 * The height every view of a section or route performance panel draws its plot at: over time,
 * spread and ahead or behind. The densest of them, over time, sets it, so the panel's plot keeps
 * the same height when the view changes.
 */
export const PERFORMANCE_PLOT_HEIGHT = 220;

/**
 * The least height the region under the plot takes, in every view, so the panel's total does not
 * move when the view changes. It is zero until a device measurement of each view's total sizes it
 * to the tallest view.
 */
export const PERFORMANCE_BELOW_PLOT_HEIGHT = 0;

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

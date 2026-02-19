import { StyleSheet } from 'react-native';
import { colors, darkColors } from './colors';
import { typography } from './typography';

export const chartStyles = StyleSheet.create({
  /** Common chart container: flex: 1 + position: relative */
  chartWrapper: {
    flex: 1,
    position: 'relative' as const,
  },

  /** Axis label with semi-transparent background (fitness/activity charts) */
  axisLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  axisLabelDark: {
    color: darkColors.textPrimary,
    backgroundColor: darkColors.surfaceOverlay,
  },

  /** Compact axis label without background (stats/curve charts) */
  axisLabelCompact: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    fontWeight: '500' as const,
  },
  axisLabelCompactDark: {
    color: darkColors.textSecondary,
  },

  /** Dark mode text override */
  textDark: {
    color: darkColors.textSecondary,
  },

  /** Tooltip overlay bar */
  tooltip: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    zIndex: 10,
    alignItems: 'center' as const,
  },
  tooltipDark: {
    backgroundColor: darkColors.surfaceOverlay,
  },
  tooltipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  tooltipTextDark: {
    color: colors.textOnDark,
  },
});

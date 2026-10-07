import { StyleSheet } from 'react-native';
import { colors, darkColors } from './colors';
import { layout, spacing } from './spacing';
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
    paddingHorizontal: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
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
});

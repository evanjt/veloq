import { Platform } from 'react-native';

/**
 * The spacing and radius scales.
 *
 * The radius scale is what the app already draws rather than what it used to
 * declare: 4, 8, 12, 16, 20, 24 and full. The old scale named 4, 8, 16 and 24,
 * so 12 and 20 were the two most-drawn radii with no token at all, and every
 * one of their call sites was a literal.
 *
 * The two micro steps, 2 and 6, are spacing rather than radius. They existed
 * only inside the chart sub-scale and are promoted out of it, because a 2 pt
 * gap on a badge is the same 2 pt gap a chart axis wants.
 */
export const spacing = {
  // Base spacing scale (8px base unit)
  xxs: 2,
  xs: 4,
  xsPlus: 6,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,

  // Chart-specific micro spacing
  chart: {
    xs: 2, // Micro spacing (axis padding)
    sm: 4, // Small gaps (label spacing)
    md: 6, // Medium gaps (tooltip padding)
    lg: 8, // Standard chart padding
  },
} as const;

/**
 * Each platform's own tap-target minimum, not one number for both: 44 pt on
 * iOS from the Human Interface Guidelines, 48 dp on Android from Material.
 * Neither is on the 8 pt grid and neither is meant to be.
 */
export const MIN_TAP_TARGET = { ios: 44, android: 48 } as const;

export const layout = {
  screenPadding: spacing.md, // 16 - Aligns to 8px grid
  cardPadding: spacing.md, // 16 - Aligns to 8px grid
  cardMargin: spacing.sm, // 8 - Aligns to 8px grid (was 12)
  borderRadiusXs: spacing.xs, // 4 - Tiny elements (dots, progress bars)
  borderRadiusSm: spacing.sm, // 8 - Aligns to 8px grid
  borderRadiusMd: 12, // 12 - Chips, small cards, inline controls
  borderRadius: spacing.md, // 16 - Aligns to 8px grid (was 12)
  borderRadiusXl: 20, // 20 - Sheets, large pills
  borderRadiusLg: spacing.lg, // 24 - Large pills, rounded containers
  borderRadiusFull: 9999, // Circles
  minTapTarget: MIN_TAP_TARGET[Platform.OS === 'android' ? 'android' : 'ios'],
} as const;

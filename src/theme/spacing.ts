export const spacing = {
  // Base spacing scale (8px base unit)
  xs: 4,
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

export const layout = {
  screenPadding: spacing.md, // 16 - Aligns to 8px grid
  cardPadding: spacing.md, // 16 - Aligns to 8px grid
  cardMargin: spacing.sm, // 8 - Aligns to 8px grid (was 12)
  borderRadius: spacing.md, // 16 - Aligns to 8px grid (was 12)
  borderRadiusSm: spacing.sm, // 8 - Aligns to 8px grid
  minTapTarget: 44, // Accessibility requirement (not on grid)
} as const;

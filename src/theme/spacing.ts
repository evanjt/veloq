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
    xs: 2,  // Micro spacing (axis padding)
    sm: 4,  // Small gaps (label spacing)
    md: 6,  // Medium gaps (tooltip padding)
    lg: 8,  // Standard chart padding
  },
} as const;

export const layout = {
  screenPadding: 16,
  cardPadding: 16,
  cardMargin: 12,
  borderRadius: 12,
  borderRadiusSm: 8,
  minTapTarget: 44,
} as const;

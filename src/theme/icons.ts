/**
 * Veloq Icon Size System
 *
 * Standardized icon sizes for consistent UI across the app.
 * All icon sizes are based on accessibility and design best practices.
 */

export const iconSizes = {
  // Micro icons for tight spaces (labels, badges)
  xs: 14, // 14px - Inline with small text, badges

  // Small icons for compact UI (buttons, list items)
  sm: 18, // 18px - Secondary actions, list items

  // Standard icons for most UI (buttons, navigation)
  md: 20, // 20px - Primary actions, navigation tabs, pill buttons

  // Large icons for emphasis (headers, cards)
  lg: 24, // 24px - Card icons, header icons, map buttons

  // Extra large icons for hero sections
  xl: 32, // 32px - Empty states, special callouts

  // Extra extra large for emphasis
  xxl: 48, // 48px - Hero empty states, onboarding
} as const;

/**
 * Context-aware icon sizes for specific UI patterns
 * Use these for automatic sizing based on component context
 */
export const iconSizesByContext = {
  // Navigation and tabs
  navigation: iconSizes.md, // 20px
  tabBar: iconSizes.md, // 20px
  bottomNav: iconSizes.lg, // 24px

  // Buttons and controls
  button: iconSizes.sm, // 18px
  buttonSmall: iconSizes.xs, // 14px
  buttonLarge: iconSizes.md, // 20px

  // Cards and lists
  cardIcon: iconSizes.lg, // 24px
  listItem: iconSizes.md, // 20px

  // Pills and badges
  pill: iconSizes.xs, // 14px
  badge: iconSizes.xs, // 14px

  // Map controls
  mapButton: iconSizes.md, // 22px (slightly larger than sm)
  mapButtonSmall: iconSizes.sm, // 18px

  // Empty states
  emptyState: iconSizes.xxl, // 48px

  // Stats and metrics
  statIcon: iconSizes.sm, // 14px - Inline with stats
  metricIcon: iconSizes.md, // 20px - Metric labels

  // Forms and inputs
  inputPrefix: iconSizes.md, // 20px
  inputSuffix: iconSizes.md, // 20px
} as const;

/**
 * Type definitions
 */
export type IconSize = keyof typeof iconSizes;
export type IconContextSize = keyof typeof iconSizesByContext;

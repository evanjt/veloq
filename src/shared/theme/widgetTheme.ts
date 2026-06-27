/**
 * Widget theme — the single source of truth for home-screen widget colours and
 * styles. Native widget code (Swift WidgetKit / Kotlin RemoteViews) cannot import
 * the app theme, so the widget snapshot carries the resolved `light`/`dark` palette
 * below and the native side renders from it. `scripts/gen-widget-theme.ts` emits the
 * same values as committed native constants for static/placeholder chrome.
 *
 * Never hardcode a hex or size in widget native files — extend this module instead.
 * Derived only from `@/theme/colors` + `@/theme/spacing` (both pure, no react-native
 * import) so the codegen can run outside the RN runtime.
 */
import { activityTypeColors, brand, colors, darkColors } from '@/theme/colors';
import { layout } from '@/theme/spacing';

/** Flat, resolved colour set the native widget renders from. */
export interface WidgetPalette {
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  /** Teal — values, accents, selected state. */
  primary: string;
  /** Gold — achievements / PR moments ONLY. */
  gold: string;
  /** Blue — CTL / data-viz series. */
  blue: string;
  /** Trend up (green). */
  trendUp: string;
  /** Trend down (neutral grey — down is not "bad"). */
  trendDown: string;
  /** Trend flat (faint grey). */
  trendFlat: string;
  border: string;
}

export const widgetPalette: { light: WidgetPalette; dark: WidgetPalette } = {
  light: {
    background: colors.background,
    surface: colors.surface,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    primary: brand.tealLight,
    gold: brand.gold,
    blue: brand.blueDark,
    trendUp: colors.success,
    trendDown: colors.textSecondary,
    trendFlat: colors.textDisabled,
    border: colors.border,
  },
  dark: {
    background: darkColors.background,
    surface: darkColors.surfaceCard,
    textPrimary: darkColors.textPrimary,
    textSecondary: darkColors.textSecondary,
    primary: brand.tealDark,
    gold: brand.gold,
    blue: brand.blue,
    trendUp: darkColors.success,
    trendDown: darkColors.textSecondary,
    trendFlat: darkColors.textDisabled,
    border: darkColors.border,
  },
};

/** Per-sport tint, mirroring the app's activity-type colours. */
export function widgetActivityTint(sportType: string): string {
  return activityTypeColors[sportType] ?? activityTypeColors.Other;
}

/** Widget layout constants (8px grid, 16px card radius — same as the home cards). */
export const widgetLayout = {
  radius: layout.borderRadius, // 16
  radiusInner: layout.borderRadiusSm, // 8
  padding: 16,
  gap: 8,
} as const;

/**
 * Widget type scale in pt. Mirrors the design-system metric/label sizes but kept as
 * plain numbers so the node codegen needn't import `@/theme/typography` (which pulls
 * in react-native).
 */
export const widgetType = {
  hero: 32,
  metric: 22,
  value: 18,
  label: 12,
  caption: 10,
} as const;

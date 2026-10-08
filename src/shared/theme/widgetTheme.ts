/**
 * Widget theme: the single source of truth for home-screen widget colours and
 * styles. Native widget code (Swift WidgetKit / Kotlin RemoteViews) cannot import
 * the app theme, so the widget snapshot carries the resolved `light`/`dark` palette
 * below and the native side renders from it. `scripts/gen-widget-theme.ts` emits the
 * same values as committed native constants for static/placeholder chrome.
 *
 * Never hardcode a hex or size in widget native files; extend this module instead.
 * Derived only from `@/theme/colors` + `@/theme/spacing` (both pure, no react-native
 * import) so the codegen can run outside the RN runtime.
 */
import {
  activityTypeColors,
  brand,
  colors,
  darkColors,
  insightToneColor,
  verdictColor,
} from '@/theme/colors';
import { layout, spacing } from '@/theme/spacing';

/** Flat, resolved colour set the native widget renders from. */
export interface WidgetPalette {
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  /** Teal: values, accents, selected state. */
  primary: string;
  /** Gold: achievements / PR moments ONLY. */
  gold: string;
  /** Blue: CTL / data-viz series. */
  blue: string;
  /** Purple: ATL / fatigue series. */
  fatigue: string;
  /** Fitness (CTL) chart line, matching the feed summary-card sparkline. */
  chartFitness: string;
  /** Fatigue (ATL) chart line, matching the feed summary-card sparkline. */
  chartFatigue: string;
  /** Under-stroke behind chart lines for edge contrast (RRGGBBAA). */
  chartCasing: string;
  /** Form zone fills keyed by the snapshot's `metrics.form.zone` enum. */
  formHighRisk: string;
  formOptimal: string;
  formGreyZone: string;
  formFresh: string;
  formTransition: string;
  /** Form zone text: the hero value and the impact numbers, which carry no label. */
  formHighRiskText: string;
  formOptimalText: string;
  formGreyZoneText: string;
  formFreshText: string;
  formTransitionText: string;
  /** An improving trend (green). */
  trendUp: string;
  /** A declining trend (the negative rung). */
  trendDown: string;
  /** A flat trend, or one with no judgement (faint grey). */
  trendFlat: string;
  /** Amber text: an age line past the point the numbers can still be called current. */
  warning: string;
  /** An insight's tone, the mark beside its row: one field per `InsightTone`. */
  toneNegative: string;
  toneCaution: string;
  tonePositive: string;
  toneNeutral: string;
  toneRecord: string;
  toneInfo: string;
  toneOpportunity: string;
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
    fatigue: colors.fatigue,
    chartFitness: colors.fitnessBlue,
    chartFatigue: colors.chartPink,
    chartCasing: colors.chartCasing,
    formHighRisk: colors.formHighRisk,
    formOptimal: colors.formOptimal,
    formGreyZone: colors.formGreyZone,
    formFresh: colors.formFresh,
    formTransition: colors.formTransition,
    formHighRiskText: colors.formHighRiskText,
    formOptimalText: colors.formOptimalText,
    formGreyZoneText: colors.formGreyZoneText,
    formFreshText: colors.formFreshText,
    formTransitionText: colors.formTransitionText,
    trendUp: verdictColor('positive', false),
    trendDown: verdictColor('negative', false),
    trendFlat: colors.textDisabled,
    warning: colors.warningAmber,
    toneNegative: insightToneColor('negative', false),
    toneCaution: insightToneColor('caution', false),
    tonePositive: insightToneColor('positive', false),
    toneNeutral: insightToneColor('neutral', false),
    toneRecord: insightToneColor('record', false),
    toneInfo: insightToneColor('info', false),
    toneOpportunity: insightToneColor('opportunity', false),
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
    fatigue: darkColors.chartFatigue,
    chartFitness: colors.fitnessBlue,
    chartFatigue: colors.chartPink,
    chartCasing: darkColors.chartCasing,
    formHighRisk: colors.formHighRisk,
    formOptimal: colors.formOptimal,
    formGreyZone: colors.formGreyZone,
    formFresh: colors.formFresh,
    formTransition: colors.formTransition,
    formHighRiskText: darkColors.formHighRiskText,
    formOptimalText: darkColors.formOptimalText,
    formGreyZoneText: darkColors.formGreyZoneText,
    formFreshText: darkColors.formFreshText,
    formTransitionText: darkColors.formTransitionText,
    trendUp: verdictColor('positive', true),
    trendDown: verdictColor('negative', true),
    trendFlat: darkColors.textDisabled,
    warning: darkColors.warningAmber,
    toneNegative: insightToneColor('negative', true),
    toneCaution: insightToneColor('caution', true),
    tonePositive: insightToneColor('positive', true),
    toneNeutral: insightToneColor('neutral', true),
    toneRecord: insightToneColor('record', true),
    toneInfo: insightToneColor('info', true),
    toneOpportunity: insightToneColor('opportunity', true),
    border: darkColors.border,
  },
};

/**
 * Quick-Record widget chrome. Static (no snapshot behind it): a teal gradient
 * surface that steps one shade deeper in the dark scheme, with a white
 * glyph/label in both.
 */
export const widgetRecord = {
  light: { gradientStart: brand.teal, gradientEnd: brand.tealLight },
  dark: { gradientStart: brand.tealLight, gradientEnd: brand.tealHover },
  foreground: colors.textOnDark,
  /** The Android widget is one fixed 57dp cell, so its chrome is smaller than a card's. */
  padding: spacing.xs,
  glyph: 28,
  gap: spacing.xxs,
  /** The label shrinks between these sizes to fit a translation on one line. */
  textMin: 8,
  textMax: 12,
  /** One line at `textMax`, fixed so the glyph and label centre together in a larger cell. */
  labelHeight: 16,
} as const;

/** Per-sport tint, mirroring the app's activity-type colours. */
export function widgetActivityTint(sportType: string): string {
  return activityTypeColors[sportType] ?? activityTypeColors.Other;
}

/** Widget layout constants (8px grid, 16px card radius, same as the home cards). */
export const widgetLayout = {
  radius: layout.borderRadius, // 16
  radiusInner: layout.borderRadiusSm, // 8
  padding: spacing.md,
  gap: spacing.sm,
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

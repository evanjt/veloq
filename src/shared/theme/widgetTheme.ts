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
  bodyDiagram,
  brand,
  colors,
  darkColors,
  insightToneColor,
  opacity,
  recording,
  verdictColor,
} from '@/theme/colors';
import { layout, spacing } from '@/theme/spacing';

/** Flat, resolved colour set the native widget renders from. */
export interface WidgetPalette {
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  /** The action blue: values, accents, selected state. */
  primary: string;
  /** Ink on a filled primary control, such as a picker's Save button. */
  textOnPrimary: string;
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
  /**
   * Form zone fills keyed by the snapshot's `metrics.form.zone` enum: a band on the form chart
   * and the key dot beside a form value, whose text stays `textPrimary`.
   */
  formHighRisk: string;
  formOptimal: string;
  formGreyZone: string;
  formFresh: string;
  formTransition: string;
  /** An improving trend (green), drawn as the arrow beside a value and never as its text. */
  trendUp: string;
  /** A declining trend (the negative rung). */
  trendDown: string;
  /** A flat trend, or one with no judgement: the ladder's neutral grey. */
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
  /** The body diagram's fill for a part with no volume, under the ramp. */
  bodyFill: string;
  /** The body diagram's volume shades, lightest first: shade n is index n - 1. */
  strengthRamp: readonly string[];
}

export const widgetPalette: { light: WidgetPalette; dark: WidgetPalette } = {
  light: {
    background: colors.surfacePage,
    surface: colors.surface,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    primary: brand.blue600,
    textOnPrimary: colors.textOnFill,
    gold: colors.achievement,
    blue: brand.blueDark,
    fatigue: colors.fatigue,
    chartFitness: colors.fitness,
    chartFatigue: colors.fatigue,
    formHighRisk: colors.formHighRisk,
    formOptimal: colors.formOptimal,
    formGreyZone: colors.formGreyZone,
    formFresh: colors.formFresh,
    formTransition: colors.formTransition,
    trendUp: verdictColor('positive', false),
    trendDown: verdictColor('negative', false),
    trendFlat: verdictColor('neutral', false),
    warning: colors.warningText,
    toneNegative: insightToneColor('negative', false),
    toneCaution: insightToneColor('caution', false),
    tonePositive: insightToneColor('positive', false),
    toneNeutral: insightToneColor('neutral', false),
    toneRecord: insightToneColor('record', false),
    toneInfo: insightToneColor('info', false),
    toneOpportunity: insightToneColor('opportunity', false),
    border: colors.border,
    bodyFill: bodyDiagram.light.untrained,
    strengthRamp: bodyDiagram.light.steps,
  },
  dark: {
    background: darkColors.surfacePage,
    surface: darkColors.surfaceRaised,
    textPrimary: darkColors.textPrimary,
    textSecondary: darkColors.textSecondary,
    primary: brand.blue550,
    textOnPrimary: colors.textOnFill,
    gold: darkColors.achievement,
    blue: brand.blue,
    fatigue: darkColors.fatigue,
    chartFitness: darkColors.fitness,
    chartFatigue: darkColors.fatigue,
    formHighRisk: darkColors.formHighRisk,
    formOptimal: darkColors.formOptimal,
    formGreyZone: darkColors.formGreyZone,
    formFresh: darkColors.formFresh,
    formTransition: darkColors.formTransition,
    trendUp: verdictColor('positive', true),
    trendDown: verdictColor('negative', true),
    trendFlat: verdictColor('neutral', true),
    warning: darkColors.warningText,
    toneNegative: insightToneColor('negative', true),
    toneCaution: insightToneColor('caution', true),
    tonePositive: insightToneColor('positive', true),
    toneNeutral: insightToneColor('neutral', true),
    toneRecord: insightToneColor('record', true),
    toneInfo: insightToneColor('info', true),
    toneOpportunity: insightToneColor('opportunity', true),
    border: darkColors.border,
    bodyFill: bodyDiagram.dark.untrained,
    strengthRamp: bodyDiagram.dark.steps,
  },
};

/**
 * Quick-Record widget chrome and every other record surface the widget targets
 * draw. Static (no snapshot behind it). The fill is the `recording` tone the
 * in-app record button wears, per scheme, so the record action is one colour on
 * every surface, and both tones carry the white glyph and label at AA text.
 * `accent` is the same tone drawn as a mark: the large widget's record glyph and
 * the Live Activity's keyline, trace, glyph and control.
 */
export const widgetRecord = {
  light: {
    gradientStart: recording.light,
    gradientEnd: recording.light,
    accent: recording.light,
  },
  dark: {
    gradientStart: recording.dark,
    gradientEnd: recording.dark,
    accent: recording.dark,
  },
  foreground: colors.textOnFill,
  /** The Android widget is one fixed 57dp cell, so its chrome is smaller than a card's. */
  padding: spacing.xs,
  glyph: 28,
  gap: spacing.xxs,
  /** The label shrinks between these sizes to fit a translation on one line. */
  textMin: 9,
  textMax: 12,
  /** One line at `textMax`, the least the label's box is, which grows with the font scale. */
  labelHeight: 16,
} as const;

/** Widget layout constants (8px grid, 16px card radius, same as the home cards). */
export const widgetLayout = {
  radius: layout.borderRadius, // 16
  radiusInner: layout.borderRadiusSm, // 8
  padding: spacing.md,
  gap: spacing.sm,
  /** One line at `widgetType.hero`, the fixed box a hero figure shrinks to fit across. */
  heroLine: 44,
  /** One line at `widgetType.metric`, the same for a metric figure. */
  metricLine: 30,
  /** The Summary widget's supporting row: a label over a value. */
  supportingRow: 40,
  /** The same row when an entry also draws a caption under its value. */
  supportingRowCaptioned: 52,
  /** The box an Insights row's glyph is drawn in, beside a title at `widgetType.label`. */
  insightGlyph: 14,
} as const;

/**
 * Widget type scale in pt (sp on Android) at the default text size. Mirrors the
 * design-system metric/label sizes but kept as plain numbers so the node codegen needn't
 * import `@/theme/typography` (which pulls in react-native). No step is under 11, the
 * smallest text the platform guidance sets on a widget.
 */
export const widgetType = {
  hero: 32,
  metric: 22,
  value: 18,
  label: 12,
  caption: 11,
  /** The smallest a line shrinks to when it is fitted to its box rather than cut off. */
  floor: 9,
} as const;

/**
 * How the widget type follows the reader's text size. Each step grows with the iOS text
 * style nearest its default size. A figure, a label or a caption is data-dense, so it follows
 * the setting up to `maxScale` times its step's default size and no further, on iOS and in the
 * labels Android paints into a chart bitmap, which the system cannot scale. A line of prose,
 * an insight, an activity's name or comparison, an empty state, follows the setting however
 * large, as prose does on the app's screens.
 */
export const widgetTextScale = {
  styles: {
    hero: 'largeTitle',
    metric: 'title2',
    value: 'body',
    label: 'caption',
    caption: 'caption2',
    floor: 'caption2',
  } satisfies Record<keyof typeof widgetType, string>,
  maxScale: 1.3,
} as const;

/**
 * How the widget charts tell their marks apart without hue. A tinted or clear Home Screen
 * draws a widget in one colour, keeping only shape and alpha, so each of these holds in
 * every mode and the colour on top is a second carrier.
 */
export const widgetChart = {
  /** Fatigue is dashed, so it reads apart from the solid fitness line. */
  fatigueDash: [3, 2],
  /** A form zone band's fill over its zone colour. */
  bandOpacity: opacity.tint4,
  /** In one colour, neighbouring bands alternate between these two alphas. */
  bandAccentedOpacities: [opacity.tint2, opacity.tint4],
  /** The line drawn at each band boundary. */
  bandBoundary: opacity.disabled,
} as const;

/**
 * How the Strength widget's body keeps its set ramp without hue. A tinted or clear Home Screen
 * draws the body in one colour, so there each shade is one colour at its own alpha.
 */
export const widgetBody = {
  /** A trained part's alpha for each shade on the ramp, the lightest first. */
  accentedOpacities: [0.35, 0.5, 0.65, 0.8, 1],
  /** An untrained part's alpha, under the lightest shade, so the silhouette stays. */
  accentedUntrainedOpacity: 0.15,
  /** The hairline drawn round an untrained part. */
  accentedOutline: 0.5,
} as const;

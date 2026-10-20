/**
 * Store screenshot theme: palettes and layout ratios for the marketing
 * composites rendered by `scripts/store-screenshots.ts`. Derived only from
 * `@/theme/colors` (pure, no react-native import) so the compositor can run
 * outside the RN runtime, mirroring `widgetTheme.ts`.
 *
 * Never add a hex literal here; extend `colors.ts` first. The accent is the
 * action blue, and gold is absent because it is reserved for achievements.
 */
import { colorWithOpacity, colors, darkColors, ink, opacity } from '@/theme/colors';

export interface StorePalette {
  /** Radial stage gradient, centre and edge. */
  bg: string;
  edge: string;
  /** Caption, subcaption and general ink. */
  cap: string;
  sub: string;
  /** Dim track of the position rule. */
  ruleBase: string;
  /** Bright travelling position mark. */
  mark: string;
  /** Device bezel gradient stops. Bezels stay dark on both palettes. */
  bezelStart: string;
  bezelEnd: string;
  /** CSS box-shadow for the device. */
  shadow: string;
}

/** The action blue of the palette's own theme. */
function accent(isDark: boolean): string {
  return isDark ? darkColors.actionPrimary : colors.actionPrimary;
}

export const storePalettes: Record<'night' | 'day', StorePalette> = {
  night: {
    bg: darkColors.surface,
    edge: darkColors.surfacePage,
    cap: darkColors.textPrimary,
    sub: darkColors.textSecondary,
    ruleBase: colorWithOpacity(accent(true), opacity.tint3),
    mark: accent(true),
    bezelStart: darkColors.surfaceRaised,
    bezelEnd: darkColors.surfacePage,
    shadow:
      `0 0 var(--glow) ${colorWithOpacity(accent(true), opacity.tint2)}, ` +
      `0 26px 90px ${colorWithOpacity(ink.black, opacity.disabled)}`,
  },
  day: {
    bg: colors.surface,
    edge: colors.border,
    cap: colors.textPrimary,
    sub: colors.textSecondary,
    ruleBase: colorWithOpacity(accent(false), opacity.tint3),
    mark: accent(false),
    bezelStart: darkColors.surfaceRaised,
    bezelEnd: darkColors.surfacePage,
    shadow: `0 22px 70px ${colorWithOpacity(colors.textPrimary, opacity.tint4)}`,
  },
};

/**
 * Every dimension derives from canvas width, so one template covers every
 * store size at identical proportions.
 */
export const storeLayout = {
  padRatio: 0.078,
  capRatio: 0.082,
  subRatio: 0.42, // of cap
  radiusRatio: 0.115,
  deviceRatio: 0.86,
  deviceRatioTablet: 0.6,
  glowRatio: 0.16,
};

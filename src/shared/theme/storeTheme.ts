/**
 * Store screenshot theme: palettes and layout ratios for the marketing
 * composites rendered by `scripts/store-screenshots.ts`. Derived only from
 * `@/theme/colors` (pure, no react-native import) so the compositor can run
 * outside the RN runtime, mirroring `widgetTheme.ts`.
 *
 * Never add a hex literal here; extend `colors.ts` first. Gold is deliberately
 * absent: the palette contract reserves it for achievements, and the store
 * accent is teal.
 */
import { brand, colors, darkColors } from '@/theme/colors';

export interface StorePalette {
  /** Radial stage gradient, centre and edge. */
  bg: string;
  edge: string;
  /** Caption, subcaption and general ink. */
  cap: string;
  sub: string;
  /** Dim track of the position rule, accent + alpha suffix. */
  ruleBase: string;
  /** Bright travelling position mark. */
  mark: string;
  /** Device bezel gradient stops. Bezels stay dark on both palettes. */
  bezelStart: string;
  bezelEnd: string;
  /** CSS box-shadow for the device. */
  shadow: string;
}

export const storePalettes: Record<'night' | 'day', StorePalette> = {
  night: {
    bg: darkColors.surface,
    edge: darkColors.background,
    cap: darkColors.textPrimary,
    sub: darkColors.textSecondary,
    ruleBase: `${brand.tealDark}33`,
    mark: brand.tealDark,
    bezelStart: darkColors.surfaceElevated,
    bezelEnd: darkColors.background,
    shadow: '0 0 var(--glow) rgba(45, 212, 191, 0.13), 0 26px 90px rgba(0, 0, 0, 0.55)',
  },
  day: {
    bg: colors.background,
    edge: colors.borderLight,
    cap: colors.textPrimary,
    sub: colors.textSecondary,
    ruleBase: `${brand.tealLight}30`,
    mark: brand.tealLight,
    bezelStart: darkColors.surfaceElevated,
    bezelEnd: darkColors.background,
    shadow: '0 22px 70px rgba(24, 24, 27, 0.28)',
  },
};

/**
 * Every dimension derives from canvas width, so one template covers every
 * store size at identical proportions. Ratios ported from the proven
 * traintime compositor.
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

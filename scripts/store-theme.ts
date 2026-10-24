/**
 * Store screenshot theme: the palette and layout ratios for the marketing
 * composites rendered by `scripts/store-screenshots.ts`. Every colour is a
 * token from the light theme. It lives beside the compositor and reads the
 * token file directly because `@/theme` pulls in react-native, which the
 * compositor does not run under.
 *
 * Never add a hex literal here; extend the token file first.
 */
import { colourTokens } from '@/theme/colourTokens.generated';
import { colorWithOpacity, darkColors, opacity } from '@/theme/colors';

const t = colourTokens.light;

export interface StorePalette {
  /** Stage base, top to bottom. */
  stageTop: string;
  stageBottom: string;
  /** The blue wash lower left and the gold wash behind the device. */
  washBlue: string;
  washBlueClear: string;
  washGold: string;
  washGoldClear: string;
  /** Track lines drawn behind everything. */
  line: string;
  /** Kicker, and the kicker on an achievement shot. */
  kicker: string;
  kickerAchievement: string;
  /** Headline and subtitle. */
  cap: string;
  sub: string;
  /** Device bezel, dark on the light stage. */
  bezel: string;
  /** CSS box-shadow for the device. */
  shadow: string;
}

export const storePalette: StorePalette = {
  stageTop: t['neutral-25'],
  stageBottom: t['blue-50'],
  washBlue: t['blue-200'],
  washBlueClear: colorWithOpacity(t['blue-200'], 0),
  washGold: t['gold-100'],
  washGoldClear: colorWithOpacity(t['gold-100'], 0),
  line: colorWithOpacity(t['blue-500'], opacity.tint1),
  kicker: t['blue-600'],
  kickerAchievement: t['gold-600'],
  cap: t['blue-900'],
  sub: t['text-secondary'],
  bezel: darkColors.surfacePage,
  shadow:
    `0 40px 90px ${colorWithOpacity(t['blue-800'], opacity.tint4)}, ` +
    `0 8px 24px ${colorWithOpacity(t['blue-800'], opacity.tint2)}`,
};

/**
 * Every dimension derives from canvas width, so one template covers every
 * store size at identical proportions.
 */
export const storeLayout = {
  padRatio: 0.078,
  capRatio: 0.078,
  subRatio: 0.44, // of cap
  kickerRatio: 0.36, // of cap
};

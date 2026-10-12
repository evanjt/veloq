/**
 * Scenario: a sport, series or brand hue is a fill, and several screens drew
 * words in it: the summary card's headline numbers in the fitness blue, the
 * HRV pink and the sport colours, the days-trained pill label in its category
 * hue on a tint of itself, between 2.18:1 and 3.31:1. Each colour is chosen
 * behind a function, where no token guard can read it.
 *
 * Expected behaviour: every word clears 4.5:1 on the ground it is drawn on, in
 * both themes.
 */

import { colors, darkColors } from '@/theme';
import {
  summaryMetricTextColor,
  SUMMARY_HUED_METRICS,
} from '@/features/home/lib/summaryMetricColour';
import { dayPillTone } from '@/features/fitness/lib/dayPillTone';
import { ACTIVITY_CATEGORIES } from '@/shared/activity/sportCategories';

/** WCAG 2.2 AA for body text. */
const AA_TEXT = 4.5;

type Rgb = [number, number, number];

/** `#RRGGBB`, `#RRGGBBAA` or `rgba(r, g, b, a)`, as channels and an alpha. */
function parse(colour: string): { rgb: Rgb; alpha: number } {
  const rgba = colour.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  }
  const hex = colour.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  return { rgb, alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 };
}

/** A translucent colour laid over an opaque ground, as the screen draws it. */
function over(top: string, ground: string): Rgb {
  const { rgb, alpha } = parse(top);
  const base = parse(ground).rgb;
  return rgb.map((c, i) => c * alpha + base[i] * (1 - alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(ink: string, ground: Rgb | string): number {
  const g = typeof ground === 'string' ? parse(ground).rgb : ground;
  const [hi, lo] = [luminance(parse(ink).rgb), luminance(g)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = {
  light: [colors.surface, colors.background, colors.backgroundAlt],
  dark: [
    darkColors.background,
    darkColors.surface,
    darkColors.surfaceElevated,
    darkColors.surfaceCard,
  ],
};

const THEMES = [
  ['light', false],
  ['dark', true],
] as const;

describe('summary card values', () => {
  it.each(
    THEMES.flatMap(([name, isDark]) => SUMMARY_HUED_METRICS.map((m) => [name, m, isDark] as const))
  )('draws the %s %s value at text contrast on every card ground', (name, metric, isDark) => {
    const ink = summaryMetricTextColor(metric, isDark);
    for (const ground of SURFACES[name]) {
      expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('the days-trained pill', () => {
  const groups = [...Object.keys(ACTIVITY_CATEGORIES), undefined];

  it.each(THEMES.flatMap(([name, isDark]) => groups.map((g) => [name, g, isDark] as const)))(
    'draws the %s label for %s at text contrast on its tint',
    (name, group, isDark) => {
      const tone = dayPillTone(group, isDark);
      for (const surface of SURFACES[name]) {
        expect(contrast(tone.ink, over(tone.fill, surface))).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  );
});

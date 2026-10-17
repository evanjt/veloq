/**
 * Scenario: the action colour is the app's blue, drawn as a filled control with
 * a white label, as a link and as the Paper and notification accents. The
 * previous teal took dark ink because white read 3.74:1 on it, so a label, a
 * link or a native accent left on the old values reads teal beside a blue icon.
 *
 * Expected behaviour: in both themes the label on a filled primary control is
 * the light ink and clears 4.5:1 on the fill, links clear 4.5:1 on every surface
 * of their theme, and no action role sits in the teal hue band.
 */

import { colors, darkColors, nativeColours } from '@/theme';
import { md3DarkScheme, md3LightScheme } from '@/theme/md3Scheme';

const AA_TEXT = 4.5;

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as Rgb;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees, 0 to 360. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Tailwind's teal steps run from 166 to 175 degrees; the band takes a margin. */
const isTeal = (hex: string) => hue(hex) >= 155 && hue(hex) <= 190;

const THEMES = [
  {
    name: 'light',
    palette: colors,
    paper: md3LightScheme,
    surfaces: [colors.surface, colors.background, colors.backgroundAlt],
  },
  {
    name: 'dark',
    palette: darkColors,
    paper: md3DarkScheme,
    surfaces: [
      darkColors.background,
      darkColors.surface,
      darkColors.surfaceElevated,
      darkColors.surfaceCard,
    ],
  },
] as const;

describe.each(THEMES)('the $name action roles', ({ palette, paper, surfaces }) => {
  it('label a filled primary control in the light ink at 4.5:1', () => {
    // One ink serves the filled primary in both themes.
    expect(luminance(colors.textOnPrimary)).toBeGreaterThan(luminance(palette.primary));
    expect(contrast(colors.textOnPrimary, palette.primary)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('label a filled Paper primary at 4.5:1', () => {
    expect(contrast(paper.onPrimary, paper.primary)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(paper.inversePrimary, paper.inverseSurface)).toBeGreaterThanOrEqual(3);
  });

  it('draw a link at 4.5:1 on every surface', () => {
    for (const surface of surfaces) {
      expect(contrast(palette.actionLink, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('carry no teal', () => {
    const roles = {
      primary: palette.primary,
      primaryHover: palette.primaryHover,
      primaryLight: palette.primaryLight,
      actionLink: palette.actionLink,
      chartAccentText: palette.chartAccentText,
      paperPrimary: paper.primary,
      paperPrimaryContainer: paper.primaryContainer,
      paperInversePrimary: paper.inversePrimary,
    };
    expect(Object.entries(roles).filter(([, hex]) => isTeal(hex))).toEqual([]);
  });
});

it('gives native code the blue as the notification accent', () => {
  expect(isTeal(nativeColours.notificationAccent)).toBe(false);
  expect(nativeColours.notificationAccent).toBe(colors.primary);
});

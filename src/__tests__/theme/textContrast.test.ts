/**
 * Scenario: the accessibility bar puts text at 4.5:1 against its background,
 * checked over the token file rather than over eighty-two screens. Colour has
 * been in one place since the token sweep, so this is one test rather than a
 * per-screen audit.
 *
 * Expected behaviour: the two text tokens the screens actually read for body
 * copy clear 4.5:1 on every surface they are drawn on, in both themes.
 * `textDisabled` is deliberately not held to it: WCAG 1.4.3 exempts text on an
 * inactive control, and an exemption written down is not the same as a gap
 * nobody noticed.
 */

import { colors, darkColors, chartStreamColors } from '@/theme';
import {
  FORM_ZONE_COLORS,
  FORM_ZONE_MARK_COLORS,
  FORM_ZONE_TEXT_COLORS,
  FORM_ZONE_TEXT_COLORS_DARK,
  type FormZone,
} from '@/features/fitness/lib/fitness';
import { widgetPalette } from '@/shared/theme/widgetTheme';
import {
  FAMILY_BARS,
  FAMILY_EXEMPTIONS,
  TOKEN_FAMILIES,
  TOKEN_GROUNDS,
  UNDER_BAR,
} from '@/theme/tokenFamilies';

/** WCAG 2.2 AA for body text. */
const AA_TEXT = 4.5;

/**
 * WCAG 2.2 AA for a graphical object that is required to understand the
 * content. A fill the athlete reads text on is not one; a border, a legend
 * swatch or a bar that is the only carrier of its meaning is.
 */
const AA_MARK = 3;

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_SURFACES = {
  surface: colors.surface,
  background: colors.background,
  backgroundAlt: colors.backgroundAlt,
};

const DARK_SURFACES = {
  background: darkColors.background,
  surface: darkColors.surface,
  surfaceElevated: darkColors.surfaceElevated,
  surfaceCard: darkColors.surfaceCard,
};

describe('region tints', () => {
  it('lifts the idle and selected regions in dark mode', () => {
    const idle = darkColors.regionTintIdle;
    const active = darkColors.regionTintActive;

    expect(idle).toMatch(/^rgba\(255, 255, 255, [\d.]+\)$/);
    expect(active).toMatch(/^rgba\(255, 255, 255, [\d.]+\)$/);
    const alpha = (tint: string) => Number(tint.match(/, ([\d.]+)\)$/)?.[1]);
    expect(alpha(idle)).toBeGreaterThan(0);
    expect(alpha(active)).toBeGreaterThan(alpha(idle));
  });
});

describe('contrastRatio', () => {
  it('puts black on white at 21:1 and a colour against itself at 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#18181B', '#18181B')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    expect(contrastRatio('#18181B', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#18181B'), 5);
  });
});

describe('body text clears AA on every surface it is drawn on', () => {
  it.each(Object.keys(LIGHT_SURFACES))('light textPrimary on %s', (surface) => {
    const ground = LIGHT_SURFACES[surface as keyof typeof LIGHT_SURFACES];
    expect(contrastRatio(colors.textPrimary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(LIGHT_SURFACES))('light textSecondary on %s', (surface) => {
    const ground = LIGHT_SURFACES[surface as keyof typeof LIGHT_SURFACES];
    expect(contrastRatio(colors.textSecondary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(DARK_SURFACES))('dark textPrimary on %s', (surface) => {
    const ground = DARK_SURFACES[surface as keyof typeof DARK_SURFACES];
    expect(contrastRatio(darkColors.textPrimary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(DARK_SURFACES))('dark textSecondary on %s', (surface) => {
    const ground = DARK_SURFACES[surface as keyof typeof DARK_SURFACES];
    expect(contrastRatio(darkColors.textSecondary, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * `textMuted` was the same grey in both themes, so the token meant to be a
   * shade darker on white and a shade lighter on black was neither: 4.34:1 on
   * `backgroundAlt` and 3.24:1 on `surfaceCard`, read at 269 sites. It is body
   * copy, a caption or a unit, not an inactive control, so the exemption
   * `textDisabled` carries does not reach it.
   */
  it.each(Object.keys(LIGHT_SURFACES))('light textMuted on %s', (surface) => {
    const ground = LIGHT_SURFACES[surface as keyof typeof LIGHT_SURFACES];
    expect(contrastRatio(colors.textMuted, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.keys(DARK_SURFACES))('dark textMuted on %s', (surface) => {
    const ground = DARK_SURFACES[surface as keyof typeof DARK_SURFACES];
    expect(contrastRatio(darkColors.textMuted, ground)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('draws the muted grey darker on white than on black, which one grey cannot', () => {
    expect(relativeLuminance(colors.textMuted)).toBeLessThan(
      relativeLuminance(darkColors.textMuted)
    );
  });

  /**
   * The series hues drawn as text. Fourteen of them coloured a number or a label
   * somewhere, and 1.4.11's exemption for a graphical object does not reach text
   * at all, so each of these sites either took a text token or took a variant of
   * its own hue measured here. Lightness moves, hue and saturation do not, so the
   * screen still reads gold for a PR and green for the optimal zone.
   */
  const TEXT_VARIANTS = [
    'chartGoldText',
    'chartFtpText',
    'formOptimalText',
    'rideText',
    'runText',
    'swimText',
  ] as const;

  it.each(TEXT_VARIANTS)('light %s clears AA on every light surface', (token) => {
    for (const ground of Object.values(LIGHT_SURFACES)) {
      expect(contrastRatio(colors[token], ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(TEXT_VARIANTS)('dark %s clears AA on every dark surface', (token) => {
    for (const ground of Object.values(DARK_SURFACES)) {
      expect(contrastRatio(darkColors[token], ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  /**
   * A variant that is the same hex as the fill it replaces would pass the ratio
   * check on a dark ground and change nothing on a light one, which is how the
   * light half of a pair goes missing.
   */
  it.each(TEXT_VARIANTS)('light %s is darker than the fill hue it stands in for', (token) => {
    const fill = token.replace(/Text$/, '') as keyof typeof colors;
    expect(relativeLuminance(colors[token])).toBeLessThan(
      relativeLuminance(colors[fill] as string)
    );
  });

  it('holds every text variant with headroom, not on the line', () => {
    const worst = Math.min(
      ...TEXT_VARIANTS.flatMap((token) => [
        ...Object.values(LIGHT_SURFACES).map((g) => contrastRatio(colors[token], g)),
        ...Object.values(DARK_SURFACES).map((g) => contrastRatio(darkColors[token], g)),
      ])
    );

    expect(worst).toBeGreaterThan(AA_TEXT);
  });

  it('holds the worst pair of the four with headroom, not on the line', () => {
    const worst = Math.min(
      ...Object.values(LIGHT_SURFACES).map((g) => contrastRatio(colors.textSecondary, g)),
      ...Object.values(DARK_SURFACES).map((g) => contrastRatio(darkColors.textSecondary, g)),
      ...Object.values(LIGHT_SURFACES).map((g) => contrastRatio(colors.textMuted, g)),
      ...Object.values(DARK_SURFACES).map((g) => contrastRatio(darkColors.textMuted, g))
    );

    expect(worst).toBeGreaterThan(AA_TEXT);
  });
});

/**
 * Scenario: the five form-zone tokens are fills for the chart bands and the
 * sparkline, and every screen that names the zone also draws the number and the
 * zone name in the same colour. A band is a ground and 1.4.11 exempts it; text
 * is held to 1.4.3 at 4.5:1 whatever names it.
 *
 * Expected behaviour: the text family beside the fills clears 4.5:1 on every
 * surface a zone-coloured word is drawn on, in both themes, including the two
 * widget grounds.
 */
describe('form zone text clears AA on every surface it is drawn on', () => {
  const ZONES: FormZone[] = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'];

  const LIGHT_GROUNDS = { ...LIGHT_SURFACES, widgetSurface: widgetPalette.light.surface };
  const DARK_GROUNDS = { ...DARK_SURFACES, widgetSurface: widgetPalette.dark.surface };

  it.each(ZONES)('light %s text on every light ground', (zone) => {
    for (const ground of Object.values(LIGHT_GROUNDS)) {
      expect(contrastRatio(FORM_ZONE_TEXT_COLORS[zone], ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(ZONES)('dark %s text on every dark ground', (zone) => {
    for (const ground of Object.values(DARK_GROUNDS)) {
      expect(contrastRatio(FORM_ZONE_TEXT_COLORS_DARK[zone], ground)).toBeGreaterThanOrEqual(
        AA_TEXT
      );
    }
  });

  it('leaves the fills alone, which are grounds and stay below the text bar', () => {
    expect(contrastRatio(FORM_ZONE_COLORS.greyZone, colors.surface)).toBeLessThan(AA_TEXT);
    expect(FORM_ZONE_TEXT_COLORS.greyZone).not.toBe(FORM_ZONE_COLORS.greyZone);
  });

  it('holds the worst pair with headroom, not on the line', () => {
    const worst = Math.min(
      ...ZONES.flatMap((zone) => [
        ...Object.values(LIGHT_GROUNDS).map((g) => contrastRatio(FORM_ZONE_TEXT_COLORS[zone], g)),
        ...Object.values(DARK_GROUNDS).map((g) =>
          contrastRatio(FORM_ZONE_TEXT_COLORS_DARK[zone], g)
        ),
      ])
    );

    expect(worst).toBeGreaterThan(AA_TEXT);
  });
});

/**
 * Scenario: a mark is the only thing that says an effort is the personal best
 * or is the activity being looked at. WCAG 1.4.11 exempts a mark whose meaning
 * is carried some other way; where nothing else carries it, the mark is a
 * graphical object and owes 3:1.
 *
 * Expected behaviour: the mark-grade tokens clear it on every surface they are
 * drawn on. `chartGold` and `chartGreen` do not, which is why the mark tokens
 * exist beside them.
 */
describe('a mark that carries its own meaning clears AA for a graphical object', () => {
  const LIGHT_MARKS = {
    chartGoldMark: colors.chartGoldMark,
    chartGreenMark: colors.chartGreenMark,
    chartSilverMark: colors.chartSilverMark,
    chartBronzeMark: colors.chartBronzeMark,
  };

  const DARK_MARKS = {
    chartGoldMark: darkColors.chartGoldMark,
    chartGreenMark: darkColors.chartGreenMark,
    chartSilverMark: darkColors.chartSilverMark,
    chartBronzeMark: darkColors.chartBronzeMark,
  };

  it.each(Object.keys(LIGHT_MARKS))('light %s on every light surface', (mark) => {
    const tone = LIGHT_MARKS[mark as keyof typeof LIGHT_MARKS];
    for (const ground of Object.values(LIGHT_SURFACES)) {
      expect(contrastRatio(tone, ground)).toBeGreaterThanOrEqual(AA_MARK);
    }
  });

  it.each(Object.keys(DARK_MARKS))('dark %s on every dark surface', (mark) => {
    const tone = DARK_MARKS[mark as keyof typeof DARK_MARKS];
    for (const ground of Object.values(DARK_SURFACES)) {
      expect(contrastRatio(tone, ground)).toBeGreaterThanOrEqual(AA_MARK);
    }
  });

  it('is a lift of the chart tones, which are the ones that fail', () => {
    expect(contrastRatio(colors.chartGold, colors.surface)).toBeLessThan(AA_MARK);
    expect(contrastRatio(colors.chartGreen, colors.surface)).toBeLessThan(AA_MARK);
  });
});

/**
 * The mark family. Each entry is a tone drawn where the graphic is the only
 * carrier of its meaning, so it answers to 1.4.11 rather than to the no-bar
 * rule a ground gets. One tone serves both themes, which is why every one is
 * measured against all six surfaces rather than against its own theme's three.
 */
const MARK_FAMILY = {
  markCyan: colors.markCyan,
  markGreen: colors.markGreen,
  markAmber: colors.markAmber,
  markYellow: colors.markYellow,
  markOrange: colors.markOrange,
  markFormTransition: colors.markFormTransition,
  markFormFresh: colors.markFormFresh,
  markFormGreyZone: colors.markFormGreyZone,
  markFormOptimal: colors.markFormOptimal,
};

/** The fill token each mark tone darkens, and which is why it exists. */
const MARK_REPLACES = {
  markCyan: colors.chartCyan,
  markGreen: colors.chartGreen,
  markAmber: colors.chartAmber,
  markYellow: colors.chartYellow,
  markOrange: colors.cautionOrange,
  markFormTransition: colors.formTransition,
  markFormFresh: colors.formFresh,
  markFormGreyZone: colors.formGreyZone,
  markFormOptimal: colors.formOptimal,
};

const ALL_SURFACES = { ...LIGHT_SURFACES, ...DARK_SURFACES };

describe('a mark holds 3:1 on every surface it can be drawn on', () => {
  it.each(Object.keys(MARK_FAMILY))('%s', (token) => {
    const mark = MARK_FAMILY[token as keyof typeof MARK_FAMILY];
    for (const ground of Object.values(ALL_SURFACES)) {
      expect(contrastRatio(mark, ground)).toBeGreaterThanOrEqual(AA_MARK);
    }
  });

  it.each(Object.keys(MARK_REPLACES))('%s darkens a fill that could not carry one', (token) => {
    const fill = MARK_REPLACES[token as keyof typeof MARK_REPLACES];
    const worst = Math.min(...Object.values(LIGHT_SURFACES).map((g) => contrastRatio(fill, g)));

    expect(worst).toBeLessThan(AA_MARK);
  });
});

describe('the marks the screens draw come from that family', () => {
  it('keys every form zone with a tone that clears the bar', () => {
    for (const zone of Object.keys(
      FORM_ZONE_MARK_COLORS
    ) as (keyof typeof FORM_ZONE_MARK_COLORS)[]) {
      for (const ground of Object.values(ALL_SURFACES)) {
        expect(contrastRatio(FORM_ZONE_MARK_COLORS[zone], ground)).toBeGreaterThanOrEqual(AA_MARK);
      }
    }
  });

  it('leaves the one zone fill that already carried a mark where it was', () => {
    expect(FORM_ZONE_MARK_COLORS.highRisk).toBe(FORM_ZONE_COLORS.highRisk);
    expect(FORM_ZONE_MARK_COLORS.optimal).not.toBe(FORM_ZONE_COLORS.optimal);
  });

  it('draws the power and gap streams in a tone that clears the bar', () => {
    for (const stream of [chartStreamColors.power, chartStreamColors.gap]) {
      for (const ground of Object.values(ALL_SURFACES)) {
        expect(contrastRatio(stream, ground)).toBeGreaterThanOrEqual(AA_MARK);
      }
    }
  });
});

/**
 * Scenario: the palette had no rule separating a text token from a fill token,
 * so nothing stopped the next one landing under the bar. Four did, and each was
 * found by somebody reading a screen rather than by a gate.
 *
 * Expected behaviour: every token in `colors` and `darkColors` is in a family,
 * a text token clears 4.5:1 and a mark 3:1 on the grounds it is drawn on in the
 * theme it lives in, and a token under its bar today is named in `UNDER_BAR`
 * with the item that owns it. An unclassified token fails, which is what stops
 * the next one.
 */
describe('every palette token answers to its family bar', () => {
  const THEMES = {
    light: { palette: colors as Record<string, string>, surfaces: LIGHT_SURFACES },
    dark: { palette: darkColors as Record<string, string>, surfaces: DARK_SURFACES },
  };

  const isHex = (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value);

  /** The grounds a token is measured on: its theme's surfaces, or its own pair. */
  function grounds(token: string, theme: keyof typeof THEMES): string[] {
    const named = TOKEN_GROUNDS[token];
    if (!named) return Object.values(THEMES[theme].surfaces);
    return named.map(
      (ground) => THEMES[theme].palette[ground] ?? colors[ground as keyof typeof colors]
    );
  }

  function worstRatio(token: string, theme: keyof typeof THEMES): number | null {
    const value = THEMES[theme].palette[token];
    if (value === undefined || !isHex(value)) return null;
    return Math.min(
      ...grounds(token, theme).map((ground) => contrastRatio(value, ground as string))
    );
  }

  const classified = Object.keys(TOKEN_FAMILIES);
  const palettes = [...new Set([...Object.keys(colors), ...Object.keys(darkColors)])];
  const held = classified.filter(
    (token) => TOKEN_FAMILIES[token] !== 'ground' && !(token in FAMILY_EXEMPTIONS)
  );

  it('classifies every token in both palettes', () => {
    expect(palettes.filter((token) => !(token in TOKEN_FAMILIES))).toStrictEqual([]);
  });

  it('classifies nothing that is not a token, so the table cannot rot', () => {
    expect(classified.filter((token) => !palettes.includes(token))).toStrictEqual([]);
  });

  it('holds every exemption and every failure to a token that exists', () => {
    const named = [...Object.keys(FAMILY_EXEMPTIONS), ...Object.keys(UNDER_BAR)];

    expect(named.filter((token) => !palettes.includes(token))).toStrictEqual([]);
  });

  /**
   * An rgba or a `transparent` cannot be measured against anything, so it can
   * only be a ground. A text or mark token has to be a colour a ratio is
   * defined for.
   */
  it('gives every text and mark token a measurable colour', () => {
    const unmeasurable = held.filter((token) =>
      (['light', 'dark'] as const).some((theme) => {
        const value = THEMES[theme].palette[token];
        return value !== undefined && !isHex(value);
      })
    );

    expect(unmeasurable).toStrictEqual([]);
  });

  it.each(held.filter((token) => !(token in UNDER_BAR)))('%s clears its bar', (token) => {
    const bar = FAMILY_BARS[TOKEN_FAMILIES[token]];

    for (const theme of ['light', 'dark'] as const) {
      const worst = worstRatio(token, theme);
      if (worst === null) continue;
      expect(`${token} ${theme} ${worst.toFixed(2)}`).toBe(
        `${token} ${theme} ${Math.max(worst, bar).toFixed(2)}`
      );
    }
  });

  /**
   * The three semantic hues each have a deep tone for the word and keep the
   * bright one for the fill under it: success, warning and, since the error
   * sweep, error. A screen that draws a word in the fill is what the detector
   * below catches.
   */
  it('gives each semantic fill a text tone that clears the text bar', () => {
    for (const [fill, deep] of [
      ['success', 'successDeep'],
      ['warning', 'warningAmber'],
      ['error', 'errorDeep'],
    ] as const) {
      expect(TOKEN_FAMILIES[fill]).toBe('ground');
      expect(TOKEN_FAMILIES[deep]).toBe('text');
      expect(worstRatio(deep, 'light')).toBeGreaterThanOrEqual(FAMILY_BARS.text);
      expect(worstRatio(deep, 'dark')).toBeGreaterThanOrEqual(FAMILY_BARS.text);
      expect(worstRatio(fill, 'light')).toBeLessThan(FAMILY_BARS.text);
    }
  });

  // The list only shortens. An entry that has been repaired fails here rather
  // than going quiet, and the one test runs whatever the list holds, so an
  // empty list is checked the same way as a full one.
  it('names only tokens that are still under their bar', () => {
    const repaired = Object.keys(UNDER_BAR).filter((token) => {
      const bar = FAMILY_BARS[TOKEN_FAMILIES[token]];
      const worst = (['light', 'dark'] as const)
        .map((theme) => worstRatio(token, theme))
        .filter((ratio): ratio is number => ratio !== null);
      return bar === undefined || worst.length === 0 || Math.min(...worst) >= bar;
    });

    expect(repaired).toEqual([]);
  });
});

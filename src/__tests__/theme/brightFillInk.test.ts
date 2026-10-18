/**
 * Scenario: the ink on a filled primary control turns white. Dark ink on the
 * primary fill also sat on the gold PR badges, the success and warning fills,
 * the light section hues and the dark destructive red, where white
 * reads between 2.1:1 and 3:1.
 *
 * Expected behaviour: every filled pair that is not the primary one names its
 * own ink and keeps 4.5:1 in both themes, whatever the primary ink is. A bright
 * fill (gold, success, warning, a light section hue) takes `textOnBright`; the
 * destructive red is the deep `dangerFill` with white in both themes.
 */

import {
  colors,
  darkColors,
  sectionNumberInk,
  sectionPalette,
  sectionPaletteInk,
  swipeAction,
} from '@/theme';
import { md3DarkScheme, md3LightScheme } from '@/theme/md3Scheme';
import { paint } from '@/shared/ui/Button';
import { badgePaint } from '@/shared/ui/Badge';
import { tabBadgeTone } from '@/shared/ui/SwipeableTabs';

const AA_TEXT = 4.5;

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function expectReadable(name: string, ink: string, ground: string) {
  const ratio = contrastRatio(ink, ground);
  expect(`${name} ${ratio.toFixed(2)}`).toBe(`${name} ${Math.max(ratio, AA_TEXT).toFixed(2)}`);
}

const THEMES = [
  ['light', false, colors],
  ['dark', true, darkColors],
] as const;

describe('bright fills take the bright-fill ink', () => {
  it.each(THEMES)('clears 4.5:1 on gold, success and warning in the %s theme', (_, __, palette) => {
    for (const ground of ['achievement', 'successFill', 'warningFill'] as const) {
      expectReadable(ground, colors.textOnBright, palette[ground]);
    }
  });

  it.each(THEMES)('draws the PR and positive tab badges readable in the %s theme', (_, isDark) => {
    const tab = { key: 'k', label: 'k', icon: 'trophy', badgeText: '1' } as const;
    for (const tone of ['pr', 'positive'] as const) {
      const { fill, ink } = badgePaint(tabBadgeTone({ ...tab, badgeTone: tone }, false), isDark);
      expectReadable(tone, ink, fill);
    }
  });

  it('draws the hide and restore swipe actions readable', () => {
    expectReadable('hide', swipeAction.hide.text, swipeAction.hide.bg);
    expectReadable('restore', swipeAction.restore.text, swipeAction.restore.bg);
  });

  it('numbers every dark-ink section slot readable on its hue', () => {
    sectionPalette.forEach((hue, slot) => {
      if (sectionPaletteInk[slot] !== 'dark') return;
      expectReadable(`slot ${slot}`, sectionNumberInk(slot), hue);
    });
  });

  it('keeps the paper containers readable', () => {
    for (const scheme of [md3LightScheme, md3DarkScheme]) {
      expectReadable('primaryContainer', scheme.onPrimaryContainer, scheme.primaryContainer);
    }
  });
});

describe('the destructive fill', () => {
  it.each(THEMES)('is the deep red with white ink in the %s theme', (_, isDark, palette) => {
    const { backgroundColor, color } = paint('destructive', isDark);

    expect({ backgroundColor, color }).toEqual({
      backgroundColor: palette.dangerFill,
      color: colors.textOnFill,
    });
    expectReadable('destructive', color, backgroundColor);
  });

  it('carries the same red under the swipe-to-delete action', () => {
    expectReadable('destructive', swipeAction.destructive.text, swipeAction.destructive.bg);
    expect(swipeAction.destructive.bg).toBe(colors.dangerFill);
  });
});

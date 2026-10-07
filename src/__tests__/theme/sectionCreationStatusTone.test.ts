/**
 * Scenario: the section-creation overlay picks its status colour in a function,
 * so no `color: colors.x` literal exists for the token guard to match. The five
 * it returned were fills, `cautionYellow` at 1.47:1, `cautionOrange` 1.94:1,
 * `success` 2.05:1, `error` 3.38:1 and `primary` 3.37:1, and the status line and
 * the size warning were both drawn in whichever it returned, on a pill that is
 * 95 per cent white. A colour chosen behind a function is invisible to every
 * token gate there is.
 *
 * Expected behaviour: the function hands back a pair, a fill for the icon and a
 * text tone for the line, and the text tone clears 4.5:1 on the pill.
 */

import { sectionSizeTone, STATUS_FILLS } from '@/features/maps/lib/sectionSizeTone';
import { colors, darkColors } from '@/theme';

/** WCAG 2.2 AA for body text. */
const AA_TEXT = 4.5;

/** The light pill is `ink.white` at 95 per cent over the map. */
const PILL = '#FFFFFF';

/** The dark pill is `darkColors.surfaceOverlay`, over the dark surface. */
const DARK_PILL = '#18181B';

function channels(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [linear[0], linear[1], linear[2]];
}

function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** One count per band the function distinguishes, plus the unselected case. */
const COUNTS = [null, 0, 1_999, 2_000, 4_999, 5_000, 6_999, 7_000, 20_000];

describe('the section-creation status tone', () => {
  it.each(COUNTS)('clears AA on the pill for %s points', (count) => {
    expect(contrastRatio(sectionSizeTone(count).text, PILL)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(COUNTS)('clears AA on the dark pill for %s points', (count) => {
    expect(contrastRatio(sectionSizeTone(count, true).text, DARK_PILL)).toBeGreaterThanOrEqual(
      AA_TEXT
    );
  });

  it.each(COUNTS)('clears the 3:1 mark bar on the dark pill for %s points', (count) => {
    expect(contrastRatio(sectionSizeTone(count, true).fill, DARK_PILL)).toBeGreaterThanOrEqual(3);
  });

  it('draws the dark pill from the dark overlay surface', () => {
    expect(darkColors.surfaceOverlay).toBe('rgba(24, 24, 27, 0.95)');
  });

  it('never hands a fill back as the text tone', () => {
    for (const count of COUNTS) {
      expect(STATUS_FILLS).not.toContain(sectionSizeTone(count).text);
    }
  });

  it('keeps a distinct fill per band, so the icon still says which', () => {
    const fills = [1_999, 2_000, 5_000, 7_000].map((c) => sectionSizeTone(c).fill);

    expect(new Set(fills).size).toBe(4);
  });

  it('still bands on the same counts, so the fix did not move the thresholds', () => {
    expect(sectionSizeTone(1_999).fill).toBe(colors.success);
    expect(sectionSizeTone(2_000).fill).toBe(colors.cautionYellow);
    expect(sectionSizeTone(5_000).fill).toBe(colors.cautionOrange);
    expect(sectionSizeTone(7_000).fill).toBe(colors.error);
  });
});

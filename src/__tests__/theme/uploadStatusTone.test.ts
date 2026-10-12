/**
 * Scenario: a recording's upload chip draws its label in the status colour on a
 * 12 per cent tint of that colour over the theme's surface. Several statuses
 * drew one value in both themes, so the local-only label sat at 2.12:1 on the
 * dark chip and the pending, uploading and failed labels under 4.5:1 on one
 * ground or the other.
 *
 * Expected behaviour: every status label clears 4.5:1 on its own chip, in both
 * themes.
 */

import { uploadStatusTone } from '@/features/recording/lib/uploadStatusTone';
import { colors, darkColors, colorWithOpacity } from '@/theme';
import type { RecordingUploadStatus } from '@/types';

/** WCAG 2.2 AA for body text; the chip label is not large text. */
const AA_TEXT = 4.5;

const STATUSES: RecordingUploadStatus[] = [
  'localOnly',
  'pending',
  'uploading',
  'uploaded',
  'failed',
  'permissionBlocked',
];

function rgb(colour: string): [number, number, number, number] {
  const rgba = colour.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  const hex = colour.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as never;
}

/** Composites a colour, possibly translucent, over an opaque ground. */
function over(colour: string, ground: string): [number, number, number] {
  const [r, g, b, a] = rgb(colour);
  const [gr, gg, gb] = rgb(ground);
  return [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ['light', false, colors.surface],
  ['dark', true, darkColors.surface],
])('the %s upload status chip', (_theme, isDark, surface) => {
  it.each(STATUSES)('draws the %s label at 4.5:1 on its tint', (status) => {
    const { color } = uploadStatusTone(isDark)[status];
    const chip = over(colorWithOpacity(color, 0.12), surface);
    expect(contrast(over(color, surface), chip)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

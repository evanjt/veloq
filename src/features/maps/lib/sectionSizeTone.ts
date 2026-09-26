/**
 * What colour the section-creation overlay says a selection's size in.
 *
 * Its own module, and a pair rather than one colour. The overlay used to choose
 * one fill in a function and draw both the icon and the status line in it, which
 * put a 1.47:1 tone on a 95 per cent white pill and hid it from every token
 * guard: a guard reads `color: colors.x` out of the source and a colour chosen
 * behind a function has no such literal. Here the choice is a value a test can
 * take, and the text half answers to the text bar while the fill keeps the band's
 * hue for the icon.
 */

import { colors } from '@/theme';

export interface SizeTone {
  /** The icon's colour. A mark, so 3:1, and it carries the band. */
  fill: string;
  /** The status line's colour. Text on the pill, so 4.5:1. */
  text: string;
}

/**
 * Every fill the bands use. Exported so a test can assert the text half is never
 * one of them, which is the mistake this module exists to stop repeating.
 */
export const STATUS_FILLS = [
  colors.primary,
  colors.success,
  colors.cautionYellow,
  colors.cautionOrange,
  colors.error,
] as const;

/**
 * The band a point count falls in. Storage is about 65 bytes a point against a
 * 500 KB limit, so 7,700 points is the ceiling and the bands warn short of it.
 */
export function sectionSizeTone(pointCount: number | null): SizeTone {
  if (pointCount === null) return { fill: colors.primary, text: colors.linkTeal };
  if (pointCount < 2000) return { fill: colors.success, text: colors.successDeep };
  if (pointCount < 5000) return { fill: colors.cautionYellow, text: colors.cautionYellowText };
  if (pointCount < 7000) return { fill: colors.cautionOrange, text: colors.cautionOrangeText };
  return { fill: colors.error, text: colors.errorDeep };
}

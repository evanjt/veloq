/**
 * How far the feed opens scrolled, so the sport and range chips sit just above
 * the first card. The search field is the native header's, so it is not here.
 *
 * The first frame has nothing measured, so it uses an estimate. The section then
 * reports its real height and the offset is corrected once, because the estimate
 * is a constant and every change to the section moves the real height away from
 * it. At 78 against an 86 dp section the feed opened with the first chip line
 * already scrolled out of view.
 */

/**
 * The first-frame estimate: one chip line and the card spacing below it, at the
 * default font scale. The 86 dp measured with the search row above the chips,
 * less that row's 36 dp bar and 8 dp padding.
 */
export const ESTIMATED_FILTER_SECTION_HEIGHT = 42;

interface OffsetCorrection {
  /** What the section just reported through `onLayout`. */
  measured: number;
  /** What the list was opened at. */
  applied: number;
  /** A search or a chip is active, so the section is meant to be on screen. */
  filtering: boolean;
  /** The correction has already been made this mount. */
  corrected: boolean;
}

/**
 * The offset to scroll to once the header has been measured, or null to leave
 * the list where it is.
 */
export function searchOffsetCorrection({
  measured,
  applied,
  filtering,
  corrected,
}: OffsetCorrection): number | null {
  if (corrected || filtering) return null;
  if (!Number.isFinite(measured) || measured <= 0) return null;
  if (Math.round(measured) === Math.round(applied)) return null;
  return Math.round(measured);
}

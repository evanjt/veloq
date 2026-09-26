/**
 * How far the feed opens scrolled, so the search bar and the sport chips sit
 * just above the first card.
 *
 * The first frame has nothing measured, so it uses an estimate. The header then
 * reports its real height and the offset is corrected once, because the estimate
 * is a constant and every header change moves the real height away from it. At
 * 78 against an 86 dp header the feed opened with the first chip line already
 * scrolled out of view.
 */

/** The first-frame estimate: a search bar and one chip line at the default font scale. */
export const ESTIMATED_SEARCH_SECTION_HEIGHT = 78;

interface OffsetCorrection {
  /** What the header just reported through `onLayout`. */
  measured: number;
  /** What the list was opened at. */
  applied: number;
  /** A search or a chip is active, so the header is meant to be on screen. */
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

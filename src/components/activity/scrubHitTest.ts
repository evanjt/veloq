// Pure hit-test for the sections-tab scrub gesture. Extracted from
// ActivitySectionsSection so it can be unit-tested without a live component.
//
// The scrub lets the user long-press a section row and drag through the list
// to highlight rows. We resolve the finger's window-Y to a row index via
// arithmetic against row 0's measured pageY and a single row-height sample.
// Measuring row 0 directly (via measureInWindow at scrub start) avoids the
// off-by-one drift we saw when we tried to derive the first-row top from
// listContainer + paddingTop on Android.

export interface ScrubHitTestParams {
  /** Finger position in window coordinates (matches RNGH Pan `absoluteY`). */
  pageY: number;
  /** Window-Y of the first row's outer View (from `measureInWindow`). */
  firstRowTopY: number;
  /** Measured outer-row height (captured from the first row's onLayout). */
  rowHeight: number;
  /** FlatList scrollOffset.y at the moment the test runs. */
  scrollOffset: number;
  /** Number of rows currently in the list. */
  rowCount: number;
}

/**
 * Map a finger window-Y to a row index, or `null` if the finger is outside
 * the list. Zones are `[firstRowTopY + N*rowHeight, firstRowTopY + (N+1)*rowHeight)`
 * so a tap anywhere within a row's visible frame — top, middle, or bottom —
 * resolves to that row.
 */
export function findRowIndexAtPageY(params: ScrubHitTestParams): number | null {
  const { pageY, firstRowTopY, rowHeight, scrollOffset, rowCount } = params;
  if (rowHeight <= 0 || rowCount <= 0) return null;
  const relY = pageY - firstRowTopY + scrollOffset;
  if (relY < 0) return null;
  const idx = Math.floor(relY / rowHeight);
  if (idx >= rowCount) return null;
  return idx;
}

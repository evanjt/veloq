export interface TabStripLayout {
  /** Whether the strip scrolls because a tab needs more than its equal share. */
  scrolls: boolean;
  /** Width of each tab. */
  widths: number[];
  /** Left edge of each tab within the strip's content. */
  offsets: number[];
  contentWidth: number;
}

function cumulative(widths: number[]): number[] {
  let x = 0;
  return widths.map((w) => {
    const offset = x;
    x += w;
    return offset;
  });
}

/**
 * Lay out a strip of tabs from the width each needs for its icon, label and
 * badge. Tabs take equal shares of `available` while every one fits its share,
 * and are sized to their content, in a scrolling strip, once any does not. A
 * tab not yet measured counts as fitting, so the first layout is the equal one.
 */
export function layoutTabStrip(needed: number[], available: number): TabStripLayout {
  const count = needed.length;
  const share = count > 0 ? available / count : 0;
  const measured = needed.length > 0 && needed.every((w) => w > 0);
  const scrolls = measured && needed.some((w) => w > share);
  const widths = scrolls ? needed : needed.map(() => share);
  return {
    scrolls,
    widths,
    offsets: cumulative(widths),
    contentWidth: widths.reduce((sum, w) => sum + w, 0),
  };
}

/** The scroll offset that centres a tab in the viewport, clamped to the content. */
export function scrollOffsetToShow(
  offset: number,
  width: number,
  viewportWidth: number,
  contentWidth: number
): number {
  const centred = offset + width / 2 - viewportWidth / 2;
  return Math.max(0, Math.min(centred, contentWidth - viewportWidth));
}

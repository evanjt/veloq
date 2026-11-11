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
 * The width each tab needs, given the content width measured for each tab so
 * far. A tab with no measurement yet needs 0, which `layoutTabStrip` reads as
 * unmeasured; a measured tab needs its content plus `padding` either side.
 */
export function neededTabWidths(
  contentWidths: readonly number[],
  count: number,
  padding: number
): number[] {
  return Array.from({ length: count }, (_, i) => {
    const content = contentWidths[i];
    return content === undefined ? 0 : content + padding * 2;
  });
}

/**
 * Lay out a strip of tabs from the width each needs for its icon, label and
 * badge, as `neededTabWidths` gives them. Tabs take equal shares of `available`
 * while every one fits its share, and are sized to their content, in a
 * scrolling strip, once any does not. Until every tab has a width the strip is
 * the equal one, so a partly measured row never lays out as a scrolling strip.
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

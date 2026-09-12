/**
 * Which feed cards are close enough to the viewport to ask for a map render.
 *
 * The list mounts two to three screens either side of what is on screen so
 * scrolling does not blank, and that is the right setting for a list. It is the
 * wrong setting for generation: a preview costs a WebView render, a sampling
 * pass and a base64 bridge crossing, and the queue is two workers deep, so a
 * fast scroll used to fill it with cards the athlete had already gone past.
 *
 * Published from the feed rather than passed down as a prop, because a prop
 * that changes on every scroll re-renders every card in the list, which is the
 * cost this exists to avoid.
 */

/** The first and last card the list currently reports as visible. */
export interface VisibleRange {
  first: number;
  last: number;
}

let visible: VisibleRange | null = null;
const listeners = new Set<() => void>();

/**
 * Whether a mounted card may ask for a render.
 *
 * One screen of lookahead, and none behind: a card above the viewport has been
 * on screen already, so it either has its preview or lost it to eviction and
 * will ask again when it comes back. A screen is however many cards are visible
 * right now, so nothing here has to know a card's height and it stays right
 * when the layout changes.
 *
 * With no range yet the answer is yes, or the first screen would never render:
 * the list reports viewability after its first layout, not before.
 */
export function withinPreviewRange(index: number, range: VisibleRange | null): boolean {
  if (!range) return true;
  const screen = Math.max(1, range.last - range.first + 1);
  return index >= range.first && index <= range.last + screen;
}

/** The same question against the range the feed last published. */
export function isWithinPreviewRange(index: number): boolean {
  return withinPreviewRange(index, visible);
}

/** Called by the feed as viewability changes. Silent when nothing moved. */
export function setVisibleRange(range: VisibleRange | null): void {
  if (range?.first === visible?.first && range?.last === visible?.last) return;
  visible = range;
  for (const listener of listeners) listener();
}

/** Told when the range moves, so a card can re-ask the question. */
export function onPreviewRangeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

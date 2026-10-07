/**
 * The ids of the cards the feed is showing, for the GPS download to ask for
 * first.
 *
 * Published rather than passed, for the same reason the preview range is: the
 * reader is the route sync, not a child of the feed, and a prop that moved
 * with the list would re-render every card to reach it. It sits in `shared`
 * rather than in either feature because both ends import it, and the barrel
 * that would otherwise carry it closes a cycle.
 */

let head: readonly string[] = [];

/** Called by the feed with the first cards that own a track. */
export function setFeedHeadIds(ids: readonly string[]): void {
  head = ids;
}

/** What the download puts at the front of its first pass. */
export function feedHeadIds(): readonly string[] {
  return head;
}

const HEAD_COUNT = 5;

/**
 * The ids of the first cards that own a track, or `held` while pages before
 * the first one held are evicted: the list then starts weeks below the top, so
 * its first cards are not the ones on screen.
 */
export function headPreviewIds(
  activities: readonly { id: string; stream_types?: string[] | null | undefined }[],
  hasPreviousPage: boolean,
  held: string[]
): string[] {
  if (hasPreviousPage) return held;
  return activities
    .filter((a) => a.stream_types?.includes('latlng'))
    .slice(0, HEAD_COUNT)
    .map((a) => a.id);
}

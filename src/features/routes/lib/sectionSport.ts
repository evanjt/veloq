/**
 * Whether a chip the athlete picked is one the section still offers.
 *
 * A chip outlives the activity behind it, and the engine answers a sport the
 * section has never seen with nothing, so the screen hands a chip it no longer
 * offers back to the engine's default rather than keep an empty answer with no
 * pill left to clear it.
 */
export function isSportOffered(sport: string, counts: readonly { sportType: string }[]): boolean {
  return counts.some((c) => c.sportType === sport);
}

/**
 * The sports a section or route page lists beside its range: one per sport the
 * screen read offers, with its count, the most traversed first. Sports with the
 * same count keep the engine's order.
 */
export function sportMenuOptions(
  counts: readonly { sportType: string; count: number }[]
): { type: string; count: number }[] {
  return counts
    .map(({ sportType, count }) => ({ type: sportType, count }))
    .sort((a, b) => b.count - a.count);
}

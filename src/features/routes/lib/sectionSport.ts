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
 * Whether the section page draws its sport chips: whenever the screen read
 * offers a sport, so a range holding one sport shows one chip. The engine
 * decides what is offered, the screen does not count.
 */
export function shouldShowSportChips(counts: readonly { sportType: string }[]): boolean {
  return counts.length > 0;
}

/**
 * The chips a section or route page offers beside its range: one per sport the screen read
 * offers, with its count, or none when `shouldShowSportChips` draws none.
 */
export function sportChipOptions(
  counts: readonly { sportType: string; count: number }[]
): { type: string; count: number }[] {
  if (!shouldShowSportChips(counts)) return [];
  return counts.map(({ sportType, count }) => ({ type: sportType, count }));
}

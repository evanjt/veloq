/** Z1 to Z7 only: the API also lists Sweet Spot, which overlaps them. */
export function powerZoneEntries<T extends { id: string }>(zoneTimes: readonly T[]): T[] {
  return zoneTimes.filter((z) => /^Z\d+$/.test(z.id));
}

/**
 * The order of the map tab's sport chips.
 *
 * The chosen sports lead in the order they were chosen, so a period change that
 * moves the counts never pushes a chosen chip past the row's visible width. The
 * rest follow by their count in the window, the largest first. A chosen sport
 * the library no longer holds keeps its chip at a count of zero, so the filter
 * it applies stays in view and can be cleared.
 */
export function sportChipOrder<K extends string>(
  categories: readonly { category: K; count: number }[],
  chosen: readonly K[]
): { category: K; count: number }[] {
  const counts = new Map(categories.map(({ category, count }) => [category, count]));
  const leading = chosen.map((category) => ({ category, count: counts.get(category) ?? 0 }));
  const rest = categories
    .filter(({ category }) => !chosen.includes(category))
    .sort((a, b) => b.count - a.count);
  return [...leading, ...rest];
}

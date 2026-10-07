interface DisplayedDayArgs<T> {
  selectedDate: string | null | undefined;
  isActive: boolean;
  /** The row of the scrubbed or pinned day, null when it has none. */
  selected: T | null;
  newest: T;
}

/** A pinned day with no row of its own shows its date over no values. */
export function displayedDay<T>({
  selectedDate,
  isActive,
  selected,
  newest,
}: DisplayedDayArgs<T>): T | null {
  if (!isActive && selectedDate && !selected) return null;
  return selected ?? newest;
}

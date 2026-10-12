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

interface HeaderDayArgs {
  selectedDate: string | null | undefined;
  isActive: boolean;
  /** The day of the scrubbed or pinned row, when it has one. */
  selectedRowDate: string | null | undefined;
  /** The newest stored day, which the header reads at rest. */
  newestDate: string;
  /** The athlete's local day, `YYYY-MM-DD`. */
  today: string;
}

/**
 * The day a chart header names: the scrubbed or pinned day, else the newest
 * stored row. A sync that has not run today leaves that row in the past, so it
 * is named by its date and reads as today only when it is.
 */
export function headerDay({
  selectedDate,
  isActive,
  selectedRowDate,
  newestDate,
  today,
}: HeaderDayArgs): { date: string; isToday: boolean } {
  const pinned = (isActive && selectedRowDate) || selectedDate;
  const date = pinned ? selectedRowDate || selectedDate || newestDate : newestDate;
  return { date, isToday: !pinned && date === today };
}

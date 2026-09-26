/**
 * The sport an insight card labels itself with.
 *
 * Shared ground holds a record in each sport that travels it, so the section's
 * own sport is not the record's: a run PR on a much-ridden climb drew a
 * bicycle until the engine started carrying the record's sport with the row.
 * The section's is the fallback, for a row from a build that carried none.
 */
export function cardSportType(record?: string, section?: string): string | undefined {
  return record || section || undefined;
}

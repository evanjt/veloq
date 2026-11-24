/**
 * Which stored push rows survive the per-athlete cap.
 *
 * A registration with no credential proves nothing about the athlete id it
 * names, so it must never push a verified row out. Legacy rows go first,
 * oldest first (a legacy newcomer into a full set of verified rows is
 * dropped itself), then the oldest verified row.
 */

export interface CappableRow {
  registeredAt: string;
  legacy?: boolean | undefined;
}

export function capTokenRows<T extends CappableRow>(
  rows: T[],
  max: number
): { kept: T[]; dropped: T[] } {
  const excess = rows.length - max;
  if (excess <= 0) return { kept: rows, dropped: [] };
  const byAge = (a: T, b: T) => a.registeredAt.localeCompare(b.registeredAt);
  // Only an explicit `false` reads as verified, as for a stored row.
  const isLegacy = (row: T) => row.legacy !== false;
  const order = [
    ...rows.filter(isLegacy).sort(byAge),
    ...rows.filter((row) => !isLegacy(row)).sort(byAge),
  ];
  const dropped = new Set(order.slice(0, excess));
  return {
    kept: rows.filter((row) => !dropped.has(row)),
    dropped: rows.filter((row) => dropped.has(row)),
  };
}

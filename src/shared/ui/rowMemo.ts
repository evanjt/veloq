/**
 * What a feed or list row has to re-render for.
 *
 * Each of these was a hand-kept list of fields, and each list was missing the
 * ones that move: the activity card compared only the name, so a body the
 * detail sync enriched kept the old render; the section row dropped `isMetric`
 * and `sportType`; the route row and the sections list skipped the geometry, so
 * a re-detection with the same visit count drew the old shape.
 *
 * The record itself is the comparison. The data comes through React Query,
 * whose structural sharing keeps an unchanged row's reference, so a new object
 * means the row actually moved and the same object means it did not. A field
 * list can only ever be missing one.
 */

/** Whether a row holding `record` and the given extra props can skip a render. */
export function rowIsUnchanged<T>(
  prev: { record: T; extras: readonly unknown[] },
  next: { record: T; extras: readonly unknown[] }
): boolean {
  if (prev.record !== next.record) return false;
  if (prev.extras.length !== next.extras.length) return false;
  return prev.extras.every((value, i) => value === next.extras[i]);
}

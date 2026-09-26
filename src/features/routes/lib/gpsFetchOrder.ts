/**
 * Which tracks the GPS download asks for first.
 *
 * The run hands Rust one list and Rust starts fifty of them at once, in the
 * order given, so on a first sync the cards at the top of the feed were
 * hundreds deep in the list and painted last. The feed publishes the ids it is
 * showing; those go to the front and everything else keeps the order the sync
 * produced.
 */

/** Put `headIds` first, in their own order, and keep the rest as they came. */
export function headFirst<T extends { id: string }>(
  activities: readonly T[],
  headIds: readonly string[]
): T[] {
  if (headIds.length === 0) return [...activities];

  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const head: T[] = [];
  const taken = new Set<string>();
  for (const id of headIds) {
    const activity = byId.get(id);
    // A head id the fetch does not owe is one already downloaded, or one from
    // a feed that has moved on. Either way there is nothing to ask for.
    if (!activity || taken.has(id)) continue;
    head.push(activity);
    taken.add(id);
  }

  return [...head, ...activities.filter((activity) => !taken.has(activity.id))];
}

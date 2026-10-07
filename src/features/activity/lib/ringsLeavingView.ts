type ViewabilityChange = { key: string; isViewable: boolean };

export function ringsLeavingView(
  changed: readonly ViewabilityChange[],
  seen: Set<string>,
  newIds: ReadonlySet<string>
): string[] {
  const leaving: string[] = [];
  for (const item of changed) {
    if (!newIds.has(item.key)) continue;
    if (item.isViewable) {
      seen.add(item.key);
    } else if (seen.delete(item.key)) {
      leaving.push(item.key);
    }
  }
  return leaving;
}

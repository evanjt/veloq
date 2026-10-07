import type { PreviewSection } from 'veloqrs';

/** A proposed section has no number to show yet, so it is counted among the run's new rows. */
export function previewNewNumber(
  sections: readonly PreviewSection[],
  selected: PreviewSection | null
): number | null {
  if (!selected || selected.status !== 'new') return null;
  const index = sections.filter((s) => s.status === 'new').findIndex((s) => s.id === selected.id);
  return index < 0 ? null : index + 1;
}

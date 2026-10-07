import { getEngine } from '@/shared/native/engine';

export function getAllSectionDisplayNames(): Record<string, string> {
  const engine = getEngine();
  if (!engine) return {};

  // Use summaries instead of full sections - faster since no polyline data
  const { summaries } = engine.getSectionSummaries();
  const customNames = engine.getAllSectionNames();
  const result: Record<string, string> = {};

  for (const summary of summaries) {
    // The engine's name: the section's own, a split child's composed from its
    // parent's, or the numbered label when it has neither.
    const name = customNames[summary.id] || summary.name;
    if (name) result[summary.id] = name;
  }
  return result;
}

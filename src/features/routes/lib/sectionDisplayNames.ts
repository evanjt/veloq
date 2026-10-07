import { getEngine } from '@/shared/native/engine';

export function getAllSectionDisplayNames(): Record<string, string> {
  const engine = getEngine();
  if (!engine) return {};

  // A summary's name is the one the engine shows: the section's own, a split
  // child's composed from its parent's, or the numbered label when it has
  // neither. Summaries carry no polyline data, so this stays a light read.
  const { summaries } = engine.getSectionSummaries();
  const result: Record<string, string> = {};

  for (const summary of summaries) {
    if (summary.name) result[summary.id] = summary.name;
  }
  return result;
}

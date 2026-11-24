import { sections } from 'veloqrs';

export function getAllSectionDisplayNames(): Record<string, string> {
  // A summary's name is the one the engine shows: the section's own, a split
  // child's composed from its parent's, or the numbered label when it has
  // neither. Summaries carry no polyline data, so this stays a light read.
  const { summaries } = sections.getSectionSummaries();
  const result: Record<string, string> = {};

  for (const summary of summaries) {
    if (summary.name) result[summary.id] = summary.name;
  }
  return result;
}

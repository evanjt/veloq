import { getEngine } from '@/shared/native/engine';
import { generateSectionName, resolveSectionNames } from '@/features/routes/lib/sectionNaming';

export function getAllSectionDisplayNames(): Record<string, string> {
  const engine = getEngine();
  if (!engine) return {};

  // Use summaries instead of full sections - faster since no polyline data
  const { summaries } = engine.getSectionSummaries();
  const customNames = engine.getAllSectionNames();
  const result: Record<string, string> = {};

  for (const summary of summaries) {
    // Use custom name if set, otherwise use name from section or generate one
    if (customNames[summary.id]) {
      result[summary.id] = customNames[summary.id];
    } else if (summary.name) {
      result[summary.id] = summary.name;
    } else {
      result[summary.id] = generateSectionName(summary);
    }
  }

  // A split sibling without a name of its own reads as a part of its parent.
  const lineages = engine.getSectionLineages().filter((l) => !customNames[l.sectionId]);
  return resolveSectionNames(result, lineages);
}

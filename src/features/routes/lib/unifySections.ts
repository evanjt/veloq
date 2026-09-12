/**
 * One list of sections from the engine's rows and the custom store's.
 *
 * The two carry the same ids for a custom section, and the engine's row is the
 * richer one: it holds the rank scores the list sorts on, the class, the
 * elevation the row renders and the bounds. The custom store carries nine
 * fields and nothing else, so taking it first dropped all of that and sorted
 * every custom section last with no elevation.
 *
 * So the engine wins wherever it has the id, and the custom store only fills
 * in a section the engine has not seen yet, which is one just created.
 */
import { generateSectionName } from '@/features/routes/lib/sectionNaming';
import type { FrequentSection, Section } from '@/features/routes/types';

export interface UnifyInput {
  engineSections: FrequentSection[];
  customSections: Section[];
  includeCustom: boolean;
}

/** A custom-store row as a section, for an id the engine does not hold. */
function fromCustomStore(custom: Section): FrequentSection {
  return {
    id: custom.id,
    sectionType: 'custom',
    name: custom.name || '',
    polyline: custom.polyline,
    sportType: custom.sportType,
    distanceMeters: custom.distanceMeters,
    activityIds: custom.activityIds || [],
    visitCount: custom.visitCount || custom.activityIds?.length || 1,
    createdAt: custom.createdAt || new Date().toISOString(),
  };
}

/** An engine row as a section, with the name it renders under. */
function fromEngine(engine: FrequentSection): FrequentSection {
  const sectionType =
    engine.sectionType === 'custom' || engine.id.startsWith('custom_') ? 'custom' : 'auto';
  return {
    ...engine,
    sectionType,
    name: engine.name || generateSectionName(engine),
    activityIds: engine.activityIds || [],
    createdAt: engine.createdAt || new Date().toISOString(),
  };
}

export function unifySections({
  engineSections,
  customSections,
  includeCustom,
}: UnifyInput): FrequentSection[] {
  const result: FrequentSection[] = [];
  const seenIds = new Set<string>();

  for (const engine of engineSections) {
    if (seenIds.has(engine.id)) continue;
    seenIds.add(engine.id);
    result.push(fromEngine(engine));
  }

  if (includeCustom) {
    for (const custom of customSections) {
      if (seenIds.has(custom.id)) continue;
      seenIds.add(custom.id);
      result.push(fromCustomStore(custom));
    }
  }

  // Disabled and superseded last, then custom before auto. Stable within each
  // group, so the engine's own nearest-distance pre-sort survives, which is
  // what the 'nearby' ordering relies on.
  result.sort((a, b) => {
    const aHidden = !!(a.disabled || a.supersededBy);
    const bHidden = !!(b.disabled || b.supersededBy);
    if (aHidden && !bHidden) return 1;
    if (!aHidden && bHidden) return -1;

    const typePriority: Record<string, number> = { custom: 0, auto: 1 };
    return (typePriority[a.sectionType] ?? 1) - (typePriority[b.sectionType] ?? 1);
  });

  return result;
}

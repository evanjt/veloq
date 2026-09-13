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
 *
 * The engine's rows arrive already ordered, filtered and paged for the query
 * the screen asked, so their order is kept exactly. A section the
 * engine has never seen has no place in that order, and goes first: it is one
 * the athlete has only just drawn, and the list is where they look for it.
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
  const engineIds = new Set(engineSections.map((s) => s.id));

  const unseen: FrequentSection[] = [];
  if (includeCustom) {
    const takenIds = new Set(engineIds);
    for (const custom of customSections) {
      if (takenIds.has(custom.id)) continue;
      takenIds.add(custom.id);
      unseen.push(fromCustomStore(custom));
    }
  }

  const seenIds = new Set<string>();
  const fromEngineRows: FrequentSection[] = [];
  for (const engine of engineSections) {
    if (seenIds.has(engine.id)) continue;
    seenIds.add(engine.id);
    fromEngineRows.push(fromEngine(engine));
  }

  return [...unseen, ...fromEngineRows];
}

/**
 * One list of sections from the engine's rows.
 *
 * The engine holds every section, custom ones included, and its page is already
 * ordered, filtered and paged for the query the screen asked. A custom section
 * the page lacks is one the query left out (hidden by the Custom chip, missed by
 * the search, or on a later page), so it has no row here. The page's order is
 * kept exactly, and a repeated id is shown once.
 */
import type { FrequentSection } from '@/features/routes/types';

export interface UnifyInput {
  engineSections: FrequentSection[];
}

/** An engine row as a section, with the name it renders under. */
function fromEngine(engine: FrequentSection): FrequentSection {
  return {
    ...engine,
    activityIds: engine.activityIds || [],
    createdAt: engine.createdAt || new Date().toISOString(),
  };
}

export function unifySections({ engineSections }: UnifyInput): FrequentSection[] {
  const seenIds = new Set<string>();
  const rows: FrequentSection[] = [];
  for (const engine of engineSections) {
    if (seenIds.has(engine.id)) continue;
    seenIds.add(engine.id);
    rows.push(fromEngine(engine));
  }
  return rows;
}

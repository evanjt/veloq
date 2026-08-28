/**
 * Section naming utilities.
 * Generates display names for sections based on custom names or auto-generation.
 */

import { resolveIsMetric } from '@/shared/app/UnitPreferenceStore';
import { i18n } from '@/i18n';
import { formatDistance } from '@/shared/format/format';

/**
 * Minimal section data needed for name generation.
 * Works with both FrequentSection from @/types and from veloqrs.
 */
interface SectionNameData {
  id: string;
  name?: string;
  sportType: string;
  distanceMeters: number;
}

/**
 * Generate a display name for a section.
 * Uses section.name if present (already contains custom name from Rust),
 * otherwise generates a name from sport type and distance.
 */
export function generateSectionName(section: SectionNameData): string {
  // Use section.name if present (includes custom names from Rust engine)
  if (section.name) return section.name;

  // Auto-generate from sport type and distance
  const isMetric = resolveIsMetric();
  const distanceStr = formatDistance(section.distanceMeters, isMetric);

  return i18n.t('sections.autoName', { sport: section.sportType, distance: distanceStr });
}

/**
 * Where a split sibling came from, as the engine's ledger records it.
 */
export interface SectionLineage {
  sectionId: string;
  parentId: string;
  discriminator: string;
}

const CARDINALS: Record<
  string,
  'sections.splitNorth' | 'sections.splitEast' | 'sections.splitSouth' | 'sections.splitWest'
> = {
  north: 'sections.splitNorth',
  east: 'sections.splitEast',
  south: 'sections.splitSouth',
  west: 'sections.splitWest',
};

/**
 * Name a split sibling from its parent's display name and the discriminator
 * its birth recorded: "Col de la Croix (north)" for a cardinal, "Col de la
 * Croix 2" for an ordinal.
 */
export function splitSectionName(parentName: string, discriminator: string): string {
  const cardinal = CARDINALS[discriminator];
  if (cardinal) {
    return i18n.t('sections.splitName', { parent: parentName, part: i18n.t(cardinal) });
  }
  return i18n.t('sections.splitOrdinal', { parent: parentName, n: discriminator });
}

/**
 * Resolve display names for every section, composing split siblings from
 * their parents. A sibling of a sibling resolves through the chain; a chain
 * that loops or leads nowhere falls back to the sibling's own name.
 */
export function resolveSectionNames(
  own: Record<string, string>,
  lineages: SectionLineage[]
): Record<string, string> {
  const byId = new Map(lineages.map((l) => [l.sectionId, l]));
  const out: Record<string, string> = { ...own };
  // Undefined means the chain broke (a loop or a missing parent); only the
  // top level falls back, so no partial composition leaks out.
  const resolve = (id: string, seen: Set<string>): string | undefined => {
    if (seen.has(id)) return undefined;
    const lineage = byId.get(id);
    if (!lineage) return own[id];
    seen.add(id);
    const parent = resolve(lineage.parentId, seen);
    return parent ? splitSectionName(parent, lineage.discriminator) : undefined;
  };
  for (const id of Object.keys(own)) {
    out[id] = resolve(id, new Set()) ?? own[id];
  }
  return out;
}

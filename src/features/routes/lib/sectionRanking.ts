/**
 * The Signature sort: the engine's interestingness percentile, pooled across
 * the catalogue or within one sport when the list is already filtered to it.
 * A section the engine has not ranked sorts last.
 */

export interface RankedSection {
  rankScore?: number;
  sportRankScore?: number;
}

export function signatureScore(section: RankedSection, withinSport: boolean): number {
  const score = withinSport ? (section.sportRankScore ?? section.rankScore) : section.rankScore;
  return score ?? -1;
}

export function sortBySignature<T extends RankedSection & { id: string }>(
  sections: T[],
  withinSport: boolean
): T[] {
  return [...sections].sort(
    (a, b) =>
      signatureScore(b, withinSport) - signatureScore(a, withinSport) || a.id.localeCompare(b.id)
  );
}

/** The orders the sections list offers. `nearby` is ranked in Rust. */
export type SectionsSortOption = 'signature' | 'visits' | 'distance' | 'name' | 'nearby';

interface SortableSection extends RankedSection {
  id: string;
  name?: string;
  visitCount?: number;
  distanceMeters?: number;
}

/**
 * Order the sections list. Every order breaks its ties by id, so the same
 * catalogue always reads the same way.
 */
export function sortSections<T extends SortableSection>(
  sections: T[],
  option: SectionsSortOption,
  withinSport: boolean
): T[] {
  if (option === 'nearby') return [...sections];
  if (option === 'signature') return sortBySignature(sections, withinSport);

  const rank = (a: T, b: T): number => {
    if (option === 'visits') return (b.visitCount ?? 0) - (a.visitCount ?? 0);
    if (option === 'distance') return (b.distanceMeters ?? 0) - (a.distanceMeters ?? 0);
    return (a.name ?? '').localeCompare(b.name ?? '');
  };

  return [...sections].sort((a, b) => rank(a, b) || a.id.localeCompare(b.id));
}

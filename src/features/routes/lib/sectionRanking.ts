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

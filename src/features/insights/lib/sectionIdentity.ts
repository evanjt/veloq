import type { Insight } from '../types';

/**
 * A section is ridden and run under one id, and each sport has its own
 * efforts, trend and records. The identity of a fact about a section is the
 * pair of its id and its exact sport type.
 *
 * Both parts are percent-encoded, so the `:` between them, the `,` between
 * pairs and the `|` the fingerprint store splits on can never occur inside
 * one. A pair with no sport is the bare encoded id: an absent sport is its own
 * identity, never a wildcard for a known one.
 */
export function sectionPairKey(sectionId: string, sportType?: string | null): string {
  const id = encodeURIComponent(sectionId);
  return sportType ? `${id}:${encodeURIComponent(sportType)}` : id;
}

/** Every section and sport pair a card covers, read from its structured data. */
export function insightPairKeys(insight: Insight): string[] {
  const sections = insight.supportingData?.sections ?? [];
  const keys = sections
    .filter((section) => !!section.sectionId)
    .map((section) => sectionPairKey(section.sectionId, section.sportType));
  if (keys.length > 0) return keys;

  if (insight.navigationTarget?.startsWith('/section/')) {
    return [sectionPairKey(insight.navigationTarget.replace('/section/', ''))];
  }

  return [];
}

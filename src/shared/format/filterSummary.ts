import type { TFunction } from 'i18next';

/**
 * The filters narrowing a list as one phrase, for the empty state that names
 * them: the search quoted, then the label of each other filter, in order.
 */
export function filterSummary(t: TFunction, search: string, labels: readonly string[]): string {
  const needle = search.trim();
  const quoted = needle ? [t('common.quoted' as never, { text: needle }) as string] : [];
  return [...quoted, ...labels].join(' · ');
}

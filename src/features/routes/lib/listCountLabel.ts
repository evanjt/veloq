import type { TFunction } from 'i18next';

/**
 * The two plural translations a list header reads: the total alone, and the
 * shown count out of the total. Both take the total as `count`, so the noun
 * agrees with it and stays inside the template in every locale.
 */
export interface ListCountKeys {
  total: string;
  ofTotal: string;
}

export const ROUTE_COUNT_KEYS: ListCountKeys = {
  total: 'trainingScreen.routesListCount',
  ofTotal: 'trainingScreen.routesListCountOfTotal',
};

export const SECTION_COUNT_KEYS: ListCountKeys = {
  total: 'trainingScreen.sectionsListCount',
  ofTotal: 'trainingScreen.sectionsListCountOfTotal',
};

/**
 * The header over a filtered list: the count shown out of the library total
 * when a search or filter narrows it, the total alone when nothing does.
 */
export function listCountLabel(
  t: TFunction,
  keys: ListCountKeys,
  shown: number,
  total: number
): string {
  if (shown === total) return t(keys.total as never, { count: total }) as string;
  return t(keys.ofTotal as never, { count: total, shown }) as string;
}

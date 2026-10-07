import type { TFunction } from 'i18next';

/**
 * The header over a filtered list: the count shown out of the library total
 * when a search or filter narrows it, the total alone when nothing does.
 */
export function listCountLabel(t: TFunction, noun: string, shown: number, total: number): string {
  if (shown === total) return `${total} ${noun}`;
  return `${t('trainingScreen.countOfTotal' as never, { shown, total }) as string} ${noun}`;
}

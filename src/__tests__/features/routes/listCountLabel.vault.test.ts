import { createInstance, type TFunction } from 'i18next';

import {
  listCountLabel,
  ROUTE_COUNT_KEYS,
  SECTION_COUNT_KEYS,
} from '@/features/routes/lib/listCountLabel';
import { loadableLocales } from '@/i18n/localeBundles';

import { resolvedLocale } from '../../i18n/resolvedLocale';

async function translatorFor(locale: string): Promise<TFunction> {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: resolvedLocale(locale) } },
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance) as TFunction;
}

describe('listCountLabel', () => {
  it('reads the total alone in the singular when the library holds one route', async () => {
    const t = await translatorFor('en-GB');
    expect(listCountLabel(t, ROUTE_COUNT_KEYS, 1, 1)).toBe('1 route');
  });

  it('reads the total alone when nothing narrows the list', async () => {
    const t = await translatorFor('en-GB');
    expect(listCountLabel(t, ROUTE_COUNT_KEYS, 42, 42)).toBe('42 routes');
  });

  it('reads the shown count of the total when a search narrows the list', async () => {
    const t = await translatorFor('en-GB');
    expect(listCountLabel(t, ROUTE_COUNT_KEYS, 3, 42)).toBe('3 of 42 routes');
    expect(listCountLabel(t, SECTION_COUNT_KEYS, 3, 42)).toBe('3 of 42 sections');
  });

  it('reads zero of the total when the search matches nothing', async () => {
    const t = await translatorFor('en-GB');
    expect(listCountLabel(t, SECTION_COUNT_KEYS, 0, 50)).toBe('0 of 50 sections');
    expect(listCountLabel(t, SECTION_COUNT_KEYS, 0, 1)).toBe('0 of 1 section');
  });

  it('keeps the noun inside the Japanese template rather than after it', async () => {
    const t = await translatorFor('ja');
    const label = listCountLabel(t, ROUTE_COUNT_KEYS, 3, 42);
    expect(label).toBe('42件中3件のルート');
    expect(listCountLabel(t, ROUTE_COUNT_KEYS, 42, 42)).toBe('42件のルート');
  });

  it.each(loadableLocales())(
    '%s renders both numbers inside one translated string',
    async (locale) => {
      const t = await translatorFor(locale);
      for (const keys of [ROUTE_COUNT_KEYS, SECTION_COUNT_KEYS]) {
        for (const [shown, total] of [
          [1, 1],
          [2, 2],
          [5, 22],
          [0, 1],
        ]) {
          const label = listCountLabel(t, keys, shown, total);
          expect(label).toContain(String(total));
          expect(label).not.toContain('{{');
          expect(label).not.toContain('trainingScreen.');
          if (shown !== total) expect(label).toContain(String(shown));
        }
      }
    }
  );
});

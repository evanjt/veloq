import { createInstance } from 'i18next';

import { loadableLocales } from '@/i18n/localeBundles';

import { resolvedLocale } from './resolvedLocale';

const KEYS = [
  'sections.activitiesCount',
  'sections.visitsCount',
  'sections.traversalsCount',
  'strength.repsCount',
  'strength.setsCount',
  'routes.customCount',
  'sections.removedCount',
  'sections.pointsCount',
] as const;

async function translatorFor(locale: string) {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: resolvedLocale(locale) } },
    interpolation: { escapeValue: false },
  });
  const translate = instance.t.bind(instance) as (
    key: string,
    options: { count: number }
  ) => string;
  return (key: string, count: number): string => translate(key, { count });
}

describe('screen count plurals', () => {
  it.each(loadableLocales())(
    '%s renders every count inside a translated string',
    async (locale) => {
      const t = await translatorFor(locale);
      for (const key of KEYS) {
        for (const count of [1, 2, 5, 22]) {
          const value = t(key, count);
          expect(value).toContain(String(count));
          expect(value).not.toBe(key);
        }
      }
    }
  );

  it.each(['en-GB', 'de-DE'])('%s uses the singular at one', async (locale) => {
    const t = await translatorFor(locale);
    for (const key of KEYS) {
      expect(t(key, 1).replace('1', '#')).not.toBe(t(key, 2).replace('2', '#'));
    }
  });

  it('Polish provides one, few and many forms', async () => {
    const t = await translatorFor('pl');
    const bundle = resolvedLocale('pl') as unknown as Record<string, Record<string, string>>;
    for (const key of KEYS) {
      const [group, name] = key.split('.');
      for (const suffix of ['one', 'few', 'many', 'other']) {
        expect(bundle[group][`${name}_${suffix}`]).toContain('{{count}}');
      }
      const form = (count: number) => t(key, count).replace(String(count), '#');
      expect(form(1)).not.toBe(form(2));
      expect(form(2)).toBe(form(22));
    }
    expect(t('sections.visitsCount', 2)).toBe('2 wizyty');
    expect(t('sections.visitsCount', 5)).toBe('5 wizyt');
  });

  it('fractional sets use the other form', async () => {
    const t = await translatorFor('en-GB');
    expect(t('strength.setsCount', 1.5)).toBe('1.5 sets');
  });
});

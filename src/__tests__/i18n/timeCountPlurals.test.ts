/**
 * Scenario: a count of one rendered through the shared time keys must use the
 * singular form of each locale ("1 year", not "1 years"), and the plural
 * categories a locale distinguishes must each have a form.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';
import { createInstance } from 'i18next';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['time.yearsCount', 'time.daysCount', 'time.daysAgo'] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

async function translatorFor(locale: string) {
  const instance = createInstance();
  const resources = resolvedLocale(locale);
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: resources } },
    interpolation: { escapeValue: false },
  });
  const translate = instance.t.bind(instance) as unknown as (
    key: string,
    options: { count: number }
  ) => string;
  return (key: string, count: number): string => translate(key, { count });
}

const SINGULAR_BY_LANGUAGE: Record<string, Record<(typeof KEYS)[number], string>> = {
  en: {
    'time.yearsCount': '1 year',
    'time.daysCount': '1 day',
    'time.daysAgo': '1 day ago',
  },
};

describe('time count plural forms', () => {
  describe.each(locales)('%s', (locale) => {
    it.each(KEYS)('%s resolves for one and for many without a raw key', async (key) => {
      const t = await translatorFor(locale);
      for (const count of [1, 2, 5, 22]) {
        const out = t(key, count);
        expect(out).not.toBe(key);
        expect(out).toContain(String(count));
      }
    });
  });

  describe.each(locales.filter((l) => l.startsWith('en')))('%s singular', (locale) => {
    it.each(KEYS)('%s renders one in the singular', async (key) => {
      const t = await translatorFor(locale);
      expect(t(key, 1)).toBe(SINGULAR_BY_LANGUAGE.en[key]);
      expect(t(key, 2)).toMatch(/^2 (years|days)/);
    });
  });

  it.each(['de-DE', 'de-CH', 'es', 'es-ES', 'es-419', 'fr', 'it', 'nl', 'pt', 'pt-BR', 'da'])(
    '%s uses a distinct singular for a count of one',
    async (locale) => {
      const t = await translatorFor(locale);
      for (const key of KEYS) {
        const one = t(key, 1).replace('1', '#');
        const many = t(key, 2).replace('2', '#');
        if (locale === 'de-CH' && key === 'time.yearsCount') continue;
        if (locale === 'nl' && key === 'time.yearsCount') continue;
        if (locale === 'da' && key === 'time.yearsCount') continue;
        expect(one).not.toBe(many);
      }
    }
  );

  it('pl separates one from few, and few from many for years', async () => {
    const t = await translatorFor('pl');
    const form = (key: string, n: number) => t(key, n).replace(String(n), '#');
    for (const key of KEYS) {
      expect(form(key, 1)).not.toBe(form(key, 2));
    }
    expect(form('time.yearsCount', 2)).not.toBe(form('time.yearsCount', 5));
    expect(form('time.yearsCount', 22)).toBe(form('time.yearsCount', 2));
  });
});

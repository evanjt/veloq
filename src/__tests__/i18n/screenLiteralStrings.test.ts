/**
 * Scenario: screens that rendered English literals, or a count beside a bare
 * plural noun, must read from every locale, and a count of one must take the
 * singular form.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';
import { createInstance } from 'i18next';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

const KEYS = [
  'recording.categories.walking',
  'recording.fieldModeGps',
  'recording.fieldModeIndoor',
  'mapScreen.distanceAny',
];

function load(locale: string): Record<string, unknown> {
  return resolvedLocale(locale);
}

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as never)?.[part], bundle);
}

async function translatorFor(locale: string) {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: load(locale) } },
    interpolation: { escapeValue: false },
  });
  return (key: string, count: number): string =>
    (instance.t as unknown as (k: string, o: object) => string)(key, { count });
}

describe('screen literal strings', () => {
  describe.each(locales)('%s', (locale) => {
    it.each(KEYS)('has a non-empty %s', (key) => {
      const value = lookup(load(locale), key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });

    it('interpolates the count into the sections detected string', async () => {
      const t = await translatorFor(locale);
      expect(t('settings.sectionsDetectedCount', 1)).toContain('1');
      expect(t('settings.sectionsDetectedCount', 7)).toContain('7');
      expect(t('settings.sectionsDetectedCount', 1)).not.toContain('{{');
    });
  });

  it('uses the singular form for a count of one in English and German', async () => {
    expect((await translatorFor('en-AU'))('settings.sectionsDetectedCount', 1)).toBe(
      '1 section detected'
    );
    expect((await translatorFor('de-DE'))('settings.sectionsDetectedCount', 1)).toBe(
      '1 Abschnitt erkannt'
    );
  });
});

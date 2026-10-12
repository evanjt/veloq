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
  return (key: string, values: object): string =>
    (instance.t as unknown as (k: string, o: object) => string)(key, values);
}

describe('screen literal strings', () => {
  describe.each(locales)('%s', (locale) => {
    it.each(KEYS)('has a non-empty %s', (key) => {
      const value = lookup(load(locale), key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });

    it('interpolates both counts into the rescan before and after', async () => {
      const t = await translatorFor(locale);
      const line = t('settings.sectionsBeforeAfter', { before: 40, after: 42 });
      expect(line).toContain('40');
      expect(line).toContain('42');
      expect(line.indexOf('40')).toBeLessThan(line.indexOf('42'));
      expect(line).not.toContain('{{');
    });
  });

  it('reads the rescan before and after in English and German', async () => {
    expect(
      (await translatorFor('en-AU'))('settings.sectionsBeforeAfter', { before: 1, after: 3 })
    ).toBe('Sections before the rescan: 1. After: 3.');
    expect(
      (await translatorFor('de-DE'))('settings.sectionsBeforeAfter', { before: 1, after: 3 })
    ).toBe('Abschnitte vor dem Suchlauf: 1. Danach: 3.');
  });
});

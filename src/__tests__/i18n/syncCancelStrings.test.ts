/**
 * The sync stop control ships three strings. Every locale needs a real
 * translation, otherwise the row reads as English. The line that names the
 * running step is held by its own test beside this one.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['syncActivities', 'syncStop', 'syncStopping'] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function settingsOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).settings as Record<string, string>;
}

describe('sync cancel strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const settings = settingsOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof settings[key]).toBe('string');
      expect(settings[key].trim().length).toBeGreaterThan(0);
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = settingsOf('en-GB');
        const copied = KEYS.filter((k) => settings[k] === english[k]);
        expect(copied).toEqual([]);
      });
    }
  });
});

/**
 * The basemap-unavailable state is the only thing a map surface can say when
 * the renderer never loaded, so it has to say it in the reader's language.
 * English left in place reads as a bug rather than an explanation.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['unavailableTitle', 'unavailableHint'] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function mapsOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).maps as Record<string, string>;
}

describe('basemap unavailable strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const maps = mapsOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof maps[key]).toBe('string');
      expect(maps[key].trim().length).toBeGreaterThan(0);
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = mapsOf('en-GB');
        const copied = KEYS.filter((key) => maps[key] === english[key]);
        expect(copied).toEqual([]);
      });
    }
  });
});

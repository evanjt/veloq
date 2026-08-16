/**
 * The elevation backfill status line ships six strings. Every locale needs a
 * real translation with the interpolation placeholders intact, otherwise the
 * line reads as English or renders a raw `{{value}}`.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = [
  'elevationBackfillRunning',
  'elevationBackfillProgress',
  'elevationBackfillComplete',
  'elevationBackfillPartial',
  'elevationBackfillRetrying',
  'elevationBackfillFailed',
] as const;

const PLACEHOLDERS: Record<string, string[]> = {
  elevationBackfillProgress: ['{{completed}}', '{{total}}'],
  elevationBackfillRetrying: ['{{value}}'],
};

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function settingsOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).settings as Record<string, string>;
}

describe('elevation backfill strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const settings = settingsOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof settings[key]).toBe('string');
      expect(settings[key].trim().length).toBeGreaterThan(0);
    });

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(settings[key]).toContain(placeholder);
      }
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = settingsOf('en-GB');
        const prose = KEYS.filter((k) => !PLACEHOLDERS[k]);
        const copied = prose.filter((k) => settings[k] === english[k]);
        expect(copied).toEqual([]);
      });
    }
  });
});

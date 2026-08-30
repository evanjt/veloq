/**
 * The change card reports the cutover in nine strings. Every locale needs a
 * real translation with the interpolation placeholders intact, otherwise the
 * card reads as English or renders a raw `{{value}}`.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = [
  'recutRunning',
  'recutRunningPhase',
  'phasePreparing',
  'phaseDetecting',
  'phaseDiffing',
  'diffTotals',
  'diffBreakdown',
  'diffUnchanged',
  'recutFailed',
] as const;

const PLACEHOLDERS: Record<string, string[]> = {
  recutRunningPhase: ['{{phase}}'],
  diffTotals: ['{{current}}', '{{proposed}}'],
  diffBreakdown: ['{{new}}', '{{changed}}', '{{gone}}'],
  diffUnchanged: ['{{sections}}'],
};

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function cardOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).whatsNew.v040 as Record<string, string>;
}

describe('cutover change card strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const card = cardOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof card[key]).toBe('string');
      expect(card[key].trim().length).toBeGreaterThan(0);
    });

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(card[key]).toContain(placeholder);
      }
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = cardOf('en-GB');
        const copied = KEYS.filter((k) => card[k] === english[k]);
        expect(copied).toEqual([]);
      });
    }
  });
});

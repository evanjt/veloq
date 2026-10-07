/**
 * The change card reports the cutover in seventeen strings. Every locale needs a
 * real translation with the interpolation placeholders intact, otherwise the
 * card reads as English or renders a raw `{{value}}`.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const PLACEHOLDERS: Record<string, string[]> = {
  recutRunningPhase: ['{{phase}}'],
  diffTotals: ['{{current}}', '{{proposed}}'],
  diffBreakdown: ['{{new}}', '{{changed}}', '{{gone}}'],
  diffUnchanged: ['{{sections}}'],
  settingsReset: ['{{changes}}'],
  settingsResetChange: ['{{label}}', '{{from}}', '{{to}}'],
};

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function cardOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).whatsNew.v040 as Record<string, string>;
}

describe('cutover change card strings', () => {
  describe.each(locales)('%s', (locale) => {
    const card = cardOf(locale);

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(card[key]).toContain(placeholder);
      }
    });
  });
});

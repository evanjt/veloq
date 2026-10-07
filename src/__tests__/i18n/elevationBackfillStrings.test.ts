/**
 * The elevation backfill status line ships thirteen strings: seven of status,
 * four that say why the download is happening and what waits on it, and two
 * for the pause control and the paused state. Every
 * locale needs a real translation with the interpolation placeholders intact,
 * otherwise the line reads as English or renders a raw `{{count}}`. The retry
 * line counts activity tracks, so it is pluralised rather than one sentence for
 * every count.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const PLACEHOLDERS: Record<string, string[]> = {
  elevationBackfillProgress: ['{{completed}}', '{{total}}'],
  elevationBackfillRetrying_one: ['{{count}}'],
  elevationBackfillRetrying_other: ['{{count}}'],
};

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function settingsOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).settings as unknown as Record<string, string>;
}

describe('elevation backfill strings', () => {
  describe.each(locales)('%s', (locale) => {
    const settings = settingsOf(locale);

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(settings[key]).toContain(placeholder);
      }
    });
  });
});

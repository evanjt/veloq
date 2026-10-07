/**
 * The stream backfill row ships six strings: the label, a pluralised count of
 * what is owed, the progress line, and the two controls. A locale missing one
 * renders the row half in English, and a placeholder dropped in translation
 * renders a raw `{{count}}` next to a Download button.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const PLACEHOLDERS: Record<string, string[]> = {
  streamBackfillOwed_one: ['{{count}}'],
  streamBackfillOwed_other: ['{{count}}'],
  streamBackfillProgress: ['{{completed}}', '{{total}}'],
};

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function settingsOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).settings as unknown as Record<string, string>;
}

function feedOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).feed as unknown as Record<string, string>;
}

describe('stream consent card strings', () => {
  describe.each(locales)('%s', (locale) => {
    const feed = feedOf(locale);

    it('keeps the count and megabytes the engine reports', () => {
      for (const form of [feed.streamConsentBody_one, feed.streamConsentBody_other]) {
        expect(form).toContain('{{count}}');
        expect(form).toContain('{{megabytes}}');
      }
    });

    it.each(['streamConsentTitle', 'streamConsentDownload', 'streamConsentDecline'])(
      'carries %s',
      (key) => {
        expect(feed[key]).toBeTruthy();
      }
    );
  });
});

describe('stream backfill strings', () => {
  describe.each(locales)('%s', (locale) => {
    const settings = settingsOf(locale);

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(settings[key]).toContain(placeholder);
      }
    });
  });
});

/**
 * The enriched activity notification picks one of three titles. Two of them
 * are new, and on a collapsed Android lock screen the title is often the only
 * line the athlete reads, so a locale that is missing one falls back to
 * English on the very line that carries the finding.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['activityRecorded', 'activityPr', 'activityFaster'] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function titlesOf(locale: string): Record<string, { title: string }> {
  return resolvedLocale(locale).notifications as unknown as Record<string, { title: string }>;
}

describe('activity notification titles', () => {
  describe.each(locales)('%s', (locale) => {
    const notifications = titlesOf(locale);

    it('keeps the three titles distinct', () => {
      const titles = KEYS.map((k) => notifications[k].title);
      expect(new Set(titles).size).toBe(KEYS.length);
    });
  });
});

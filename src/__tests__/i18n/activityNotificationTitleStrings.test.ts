/**
 * The enriched activity notification picks one of three titles. Two of them
 * are new, and on a collapsed Android lock screen the title is often the only
 * line the athlete reads, so a locale that is missing one falls back to
 * English on the very line that carries the finding.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['activityRecorded', 'activityPr', 'activityFaster'] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function titlesOf(locale: string): Record<string, { title: string }> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).notifications as Record<string, { title: string }>;
}

describe('activity notification titles', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const notifications = titlesOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof notifications[key]?.title).toBe('string');
      expect(notifications[key].title.trim().length).toBeGreaterThan(0);
    });

    it('keeps the three titles distinct', () => {
      const titles = KEYS.map((k) => notifications[k].title);
      expect(new Set(titles).size).toBe(KEYS.length);
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the new titles rather than copying English', () => {
        const english = titlesOf('en-GB');
        const copied = KEYS.filter((k) => notifications[k].title === english[k].title);
        expect(copied).toEqual([]);
      });
    }
  });
});

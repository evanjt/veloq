/**
 * The detection preview ships twenty-six settings strings and two section
 * metric labels. Every locale needs a real translation with the interpolation
 * placeholders intact, otherwise the screen reads as English or renders a raw
 * `{{count}}`.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const SETTINGS_KEYS = [
  'previewSections',
  'previewAreaFallback',
  'previewAreaVisits',
  'previewAreaSections',
  'sectionMaxLength',
  'sectionSameTraffic',
  'previewRun',
  'previewRunning',
  'previewFailed',
  'previewSuspended',
  'previewUnchanged',
  'previewChanged',
  'previewNew',
  'previewGone',
  'previewStatusUnchanged',
  'previewStatusChanged',
  'previewStatusNew',
  'previewStatusGone',
  'previewCurrentLayer',
  'previewProposedLayer',
  'previewKeep',
  'previewDiscard',
  'previewKeepTitle',
  'previewKeepWarning',
  'previewKeepRefusedTitle',
  'previewKeepRefused',
] as const;

const SECTIONS_KEYS = ['elevationGain', 'avgGrade'] as const;

const PLACEHOLDERS: Record<string, string[]> = {
  previewAreaFallback: ['{{number}}'],
  previewAreaVisits: ['{{count}}'],
  previewAreaSections: ['{{count}}'],
  sectionMaxLength: ['{{meters}}'],
  sectionSameTraffic: ['{{value}}'],
  previewRunning: ['{{count}}'],
  previewUnchanged: ['{{count}}'],
  previewChanged: ['{{count}}'],
  previewNew: ['{{count}}'],
  previewGone: ['{{count}}'],
};

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function blockOf(locale: string, block: 'settings' | 'sections'): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw)[block] as Record<string, string>;
}

describe('detection preview strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const settings = blockOf(locale, 'settings');
    const sections = blockOf(locale, 'sections');

    it.each(SETTINGS_KEYS)('defines settings.%s', (key) => {
      expect(typeof settings[key]).toBe('string');
      expect(settings[key].trim().length).toBeGreaterThan(0);
    });

    it.each(SECTIONS_KEYS)('defines sections.%s', (key) => {
      expect(typeof sections[key]).toBe('string');
      expect(sections[key].trim().length).toBeGreaterThan(0);
    });

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(settings[key]).toContain(placeholder);
      }
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = blockOf('en-GB', 'settings');
        const englishSections = blockOf('en-GB', 'sections');
        const prose = SETTINGS_KEYS.filter((k) => !PLACEHOLDERS[k]);
        const copied = [
          ...prose.filter((k) => settings[k] === english[k]),
          ...SECTIONS_KEYS.filter((k) => sections[k] === englishSections[k]),
        ];
        expect(copied).toEqual([]);
      });
    }
  });
});

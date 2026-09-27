/**
 * The detection preview ships thirty-six settings strings and two section
 * metric labels. Every locale needs a real translation with the interpolation
 * placeholders intact, otherwise the screen reads as English or renders a raw
 * `{{count}}`.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const PLACEHOLDERS: Record<string, string[]> = {
  previewAreaFallback: ['{{letter}}'],
  previewAreaVisits: ['{{count}}'],
  previewAreaSections: ['{{count}}'],
  sectionMaxLength: ['{{distance}}'],
  sectionSameTraffic: ['{{value}}'],
  previewRunning: ['{{count}}'],
  previewUnchanged: ['{{count}}'],
  previewChanged: ['{{count}}'],
  previewNew: ['{{count}}'],
  previewGone: ['{{count}}'],
  previewPoolCost: ['{{count}}', '{{duration}}'],
  previewPoolUnreadable: ['{{count}}'],
  sectionParamRange: ['{{min}}', '{{max}}'],
};

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function blockOf(locale: string, block: 'settings' | 'sections'): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw)[block] as Record<string, string>;
}

describe('detection preview strings', () => {
  describe.each(locales)('%s', (locale) => {
    const settings = blockOf(locale, 'settings');

    it.each(Object.keys(PLACEHOLDERS))('keeps the placeholders of %s', (key) => {
      for (const placeholder of PLACEHOLDERS[key]) {
        expect(settings[key]).toContain(placeholder);
      }
    });
  });
});

/**
 * The detection preview ships thirty-six settings strings and two section
 * metric labels. Every locale needs a real translation with the interpolation
 * placeholders intact, otherwise the screen reads as English or renders a raw
 * `{{count}}`.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const PLACEHOLDERS: Record<string, string[]> = {
  previewAreaFallback: ['{{letter}}'],
  previewAreaVisits_one: ['{{count}}'],
  previewAreaVisits_other: ['{{count}}'],
  previewAreaSections_one: ['{{count}}'],
  previewAreaSections_other: ['{{count}}'],
  sectionMaxLength: ['{{distance}}'],
  sectionSameTraffic: ['{{value}}'],
  previewRunning_one: ['{{count}}'],
  previewRunning_other: ['{{count}}'],
  previewUnchanged_one: ['{{count}}'],
  previewUnchanged_other: ['{{count}}'],
  previewChanged_one: ['{{count}}'],
  previewChanged_other: ['{{count}}'],
  previewNew_one: ['{{count}}'],
  previewNew_other: ['{{count}}'],
  previewGone_one: ['{{count}}'],
  previewGone_other: ['{{count}}'],
  previewPoolCost_one: ['{{count}}', '{{duration}}'],
  previewPoolCost_other: ['{{count}}', '{{duration}}'],
  previewPoolUnreadable_one: ['{{count}}'],
  previewPoolUnreadable_other: ['{{count}}'],
  sectionParamRange: ['{{min}}', '{{max}}'],
};

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function blockOf(locale: string, block: 'settings' | 'sections'): Record<string, string> {
  return resolvedLocale(locale)[block] as Record<string, string>;
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

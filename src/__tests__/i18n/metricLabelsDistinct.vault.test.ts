/**
 * Scenario: the summary card names its supporting metrics with the translated
 * metric labels. A locale that gives two of them one word makes two tiles read
 * the same and speak one name for two different numbers.
 *
 * Expected behaviour: in every locale, the labels for these metrics are
 * pairwise distinct once the locale's fallback chain is applied.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const METRICS = ['fitness', 'form', 'hrv', 'rhr', 'eftp', 'pace', 'css', 'week'] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function labelsOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).metrics as unknown as Record<string, string>;
}

describe('metric labels', () => {
  describe.each(locales)('%s', (locale) => {
    it('gives each supporting metric its own label', () => {
      const labels = labelsOf(locale);
      const values = METRICS.map((key) => labels[key]);
      expect(new Set(values).size).toBe(METRICS.length);
    });
  });
});

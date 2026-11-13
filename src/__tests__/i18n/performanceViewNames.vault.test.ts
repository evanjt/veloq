/**
 * The section performance panel names its views by the question each answers,
 * and every locale an athlete can read carries the three names.
 */

import * as fs from 'fs';
import * as path from 'path';

import { PLOT_LABEL_KEYS } from '@/features/routes/lib/performancePanel';
import { resolvedLocale } from './resolvedLocale';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function viewNames(locale: string): string[] {
  const sections = resolvedLocale(locale).sections as unknown as Record<string, string>;
  return Object.values(PLOT_LABEL_KEYS).map((key) => sections[key.replace('sections.', '')]!);
}

describe('the performance view names', () => {
  it('cover all seventeen locales', () => {
    expect(locales).toHaveLength(17);
  });

  it('read as questions in the source locale', () => {
    expect(viewNames('en-GB')).toEqual(['Over time', 'Spread', 'Ahead or behind']);
  });

  it.each(locales)('exist in %s', (locale) => {
    for (const name of viewNames(locale)) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it.each(locales.filter((l) => !l.startsWith('en')))('are translated in %s', (locale) => {
    expect(viewNames(locale)).not.toEqual(viewNames('en-GB'));
  });
});

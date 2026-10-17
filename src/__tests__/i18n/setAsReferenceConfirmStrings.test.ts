/**
 * Using an attempt as a section's reference changes three things the athlete sees: the line the
 * section draws, the zero of the ahead-or-behind plot, and which rides match. The confirm must
 * name all three before the athlete accepts, in every locale.
 */

import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function confirmOf(locale: string): string {
  return (resolvedLocale(locale).sections as unknown as Record<string, string>)
    .setAsReferenceConfirm;
}

describe('the use as reference confirm', () => {
  it('names the line, the plot and the re-match in the source locale', () => {
    const message = confirmOf('en-GB');
    expect(message).toMatch(/\bline\b/);
    expect(message).toMatch(/Delta plot/);
    expect(message).toMatch(/ahead or behind/);
    expect(message).toMatch(/re-matched/);
  });

  it.each(locales.filter((l) => !l.startsWith('en')))(
    'is translated from the current source in %s',
    (locale) => {
      const message = confirmOf(locale);
      expect(message).not.toBe(confirmOf('en-GB'));
      expect(message.split('\n\n')).toHaveLength(confirmOf('en-GB').split('\n\n').length);
    }
  );

  it.each(locales)('has the excluded attempt notice in %s', (locale) => {
    const sections = resolvedLocale(locale).sections as unknown as Record<string, string>;
    expect(sections.attemptExcluded).toBeTruthy();
  });
});

/**
 * Scenario: a translated sentence carries a percentage, and the caller formats the figure with
 * the locale's percent formatter.
 * Expected behaviour: no template writes its own percent sign after a placeholder, because the
 * formatted figure already carries the sign and the locale's spacing.
 */
import { loadableLocales } from '@/i18n/localeBundles';

import { resolvedLocale } from './resolvedLocale';

const PLACEHOLDER_THEN_SIGN = /\{\{\s*\w+\s*\}\}\s?%/;

function literalPercentSigns(node: unknown, path: string, found: string[]): string[] {
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      literalPercentSigns(value, path ? `${path}.${key}` : key, found);
    }
  } else if (typeof node === 'string' && PLACEHOLDER_THEN_SIGN.test(node)) {
    found.push(`${path}: ${node}`);
  }
  return found;
}

it.each(loadableLocales())('%s templates leave the percent sign to the formatter', (locale) => {
  expect(literalPercentSigns(resolvedLocale(locale), '', [])).toEqual([]);
});

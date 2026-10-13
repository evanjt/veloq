/**
 * Scenario: a key already split into plural forms, where i18next picks the form
 * from the count.
 * Expected behaviour: each form is written out in full, so no form carries a
 * parenthesised ending such as "item(s)" that leaves the reader to choose.
 */
import { loadableLocales } from '@/i18n/localeBundles';

import { resolvedLocale } from './resolvedLocale';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const BRACKETED_ENDING = /\p{L}\(\p{L}+\)/u;

function bracketedPlurals(node: unknown, path: string, found: string[]): string[] {
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      bracketedPlurals(value, path ? `${path}.${key}` : key, found);
    }
  } else if (typeof node === 'string' && PLURAL_SUFFIX.test(path) && BRACKETED_ENDING.test(node)) {
    found.push(`${path}: ${node}`);
  }
  return found;
}

it.each(loadableLocales())('%s spells out every plural form', (locale) => {
  expect(bracketedPlurals(resolvedLocale(locale), '', [])).toEqual([]);
});

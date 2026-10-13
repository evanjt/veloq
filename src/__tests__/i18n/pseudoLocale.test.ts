/**
 * The pseudo-locale shows text expansion and untranslated strings on screen
 * before any translation exists. It is only useful if every string it produces
 * still interpolates, and only safe if a release build cannot select it.
 */

import { loadLocale } from '@/i18n/localeBundles';
import { SUPPORTED_LOCALES } from '@/i18n/types';
import {
  PSEUDO_LOCALE,
  pseudoLocalise,
  pseudoResource,
  registeredLocales,
} from '@/i18n/pseudoLocale';

const TOKEN = /\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+\s*\/?>/g;

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key)
  );
}

const reference = loadLocale('en-GB');
const pseudo = pseudoResource(reference);
const referenceLeaves = leaves(reference);
const pseudoLeaves = new Map(leaves(pseudo));

describe('pseudoLocalise', () => {
  it('keeps interpolation tokens, nesting calls and component tags byte for byte', () => {
    const source = 'Hello {{athleteName}}, $t(common.save) <bold>now</bold> <0/>';
    const out = pseudoLocalise(source);
    expect(out.match(TOKEN)).toEqual(source.match(TOKEN));
  });

  it('accents every letter outside a token and brackets both ends', () => {
    const out = pseudoLocalise('Save {{count}} rides');
    expect(out.startsWith('[')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    expect(out.replace(TOKEN, '')).not.toMatch(/[A-Za-z]/);
  });

  it('lengthens a single character string', () => {
    expect(pseudoLocalise('W').length).toBeGreaterThanOrEqual(Math.ceil(1 * 1.3));
  });

  it('leaves an empty string empty', () => {
    expect(pseudoLocalise('')).toBe('');
  });
});

describe('pseudoResource over the reference table', () => {
  it('keeps every key and no more', () => {
    expect([...pseudoLeaves.keys()]).toEqual(referenceLeaves.map(([key]) => key));
  });

  it('keeps every token of every string and lengthens each by at least 30 per cent', () => {
    const offenders = referenceLeaves
      .filter(([, text]) => text.length > 0)
      .filter(([key, text]) => {
        const out = pseudoLeaves.get(key)!;
        const tokensKept =
          JSON.stringify(out.match(TOKEN) ?? []) === JSON.stringify(text.match(TOKEN) ?? []);
        return !tokensKept || out.length < Math.ceil(text.length * 1.3);
      })
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('does not alter the reference table it was built from', () => {
    expect(leaves(loadLocale('en-GB'))).toEqual(referenceLeaves);
  });
});

describe('pseudo-locale registration', () => {
  it('is never a supported locale', () => {
    expect(SUPPORTED_LOCALES as readonly string[]).not.toContain(PSEUDO_LOCALE);
  });

  it('is absent from the release locale list', () => {
    expect(registeredLocales(false)).not.toContain(PSEUDO_LOCALE);
    expect(registeredLocales(false)).toEqual([...SUPPORTED_LOCALES]);
  });

  it('is registered in a development build alongside every supported locale', () => {
    expect(registeredLocales(true)).toEqual([...SUPPORTED_LOCALES, PSEUDO_LOCALE]);
  });
});

/**
 * A development-only pseudo-locale, built from the reference English table.
 *
 * Every string is rewritten with accented letters, lengthened by about 40 per
 * cent and wrapped in brackets, so a label that clips, a row that overflows or
 * a string that never went through `t()` shows on screen before any translation
 * exists. Interpolation tokens, nesting calls and component tags are left
 * untouched, because i18next and `Trans` still have to find them.
 *
 * It is registered only in development builds and never joins
 * `SUPPORTED_LOCALES`, so a release build cannot select it.
 */

import { SUPPORTED_LOCALES } from './types';

/** The tag the pseudo resource is registered under, the conventional accented English pseudo-locale. */
export const PSEUDO_LOCALE = 'en-XA';

/** How much longer each string is made, matching the expansion translations commonly need. */
const EXPANSION = 0.4;

const PADDING = '~';

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTS = [...'áƀçðéƒĝĥíĵķļɱñöþǫŕšţûṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'];
const ACCENTED = new Map(
  [...PLAIN].flatMap((letter, i) => {
    const accent = ACCENTS[i];
    return accent ? [[letter, accent] as const] : [];
  })
);

/** `{{value}}`, `$t(key)` and `<tag>`, `</tag>`, `<0/>`: the parts i18next and `Trans` read. */
const PROTECTED = /(\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+\s*\/?>)/;

/** One string in the pseudo-locale. An empty string stays empty, so a deliberate blank is not filled. */
export function pseudoLocalise(text: string): string {
  if (text.length === 0) return text;
  const accented = text
    .split(PROTECTED)
    .map((part, i) =>
      // split with a capture group puts every protected part at an odd index
      i % 2 === 1 ? part : part.replace(/[A-Za-z]/g, (letter) => ACCENTED.get(letter) ?? letter)
    )
    .join('');
  const padding = PADDING.repeat(Math.ceil(text.length * EXPANSION));
  return `[${accented}${padding}]`;
}

/** A whole resource in the pseudo-locale, keys and shape unchanged, every string leaf rewritten. */
export function pseudoResource<T>(resource: T): T {
  if (typeof resource === 'string') return pseudoLocalise(resource) as T;
  if (Array.isArray(resource)) return resource.map((item) => pseudoResource(item)) as T;
  if (resource !== null && typeof resource === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resource)) out[key] = pseudoResource(value);
    return out as T;
  }
  return resource;
}

/** The locales i18next is told are valid: the pseudo-locale joins them only in a development build. */
export function registeredLocales(isDevelopment: boolean): string[] {
  return isDevelopment ? [...SUPPORTED_LOCALES, PSEUDO_LOCALE] : [...SUPPORTED_LOCALES];
}

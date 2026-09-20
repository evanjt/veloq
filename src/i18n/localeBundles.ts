/**
 * The locale bundles, loaded when one is wanted rather than all at launch.
 *
 * Seventeen static imports built one `resources` object at module evaluation, so
 * every launch materialised about 1.5 MB of object literals on the JS thread
 * inside the bundle-evaluation window, whichever locale the athlete reads. A
 * `require` is still bundled by Metro, but it is not evaluated until called.
 */

import { LOCALE_FALLBACKS, type SupportedLocale } from './types';

/**
 * The locale every chain ends at, so it is always loaded: a key missing from
 * the athlete's own locale is read from here rather than shown as its key.
 */
export const ROOT_LOCALE: SupportedLocale = 'en-GB';

type Bundle = Record<string, unknown>;

const LOADERS: Record<SupportedLocale, () => Bundle> = {
  'en-AU': () => require('./locales/en-AU.json'),
  'en-US': () => require('./locales/en-US.json'),
  'en-GB': () => require('./locales/en-GB.json'),
  es: () => require('./locales/es.json'),
  'es-ES': () => require('./locales/es-ES.json'),
  'es-419': () => require('./locales/es-419.json'),
  fr: () => require('./locales/fr.json'),
  'de-DE': () => require('./locales/de-DE.json'),
  'de-CH': () => require('./locales/de-CH.json'),
  nl: () => require('./locales/nl.json'),
  it: () => require('./locales/it.json'),
  pt: () => require('./locales/pt.json'),
  'pt-BR': () => require('./locales/pt-BR.json'),
  ja: () => require('./locales/ja.json'),
  'zh-Hans': () => require('./locales/zh-Hans.json'),
  pl: () => require('./locales/pl.json'),
  da: () => require('./locales/da.json'),
};

/**
 * Which bundles `locale` needs: itself, everything its fallback chain names,
 * and the root. Deduplicated, in the order i18next would consult them, and
 * filtered to locales that have a bundle: the chain map carries regional tags
 * like `en-NZ` that resolve to another locale's file rather than having one.
 */
export function localesToLoad(locale: string): SupportedLocale[] {
  const wanted = [locale, ...(LOCALE_FALLBACKS[locale] ?? []), ROOT_LOCALE];
  const seen = new Set<string>();
  return wanted.filter((candidate): candidate is SupportedLocale => {
    if (seen.has(candidate) || !(candidate in LOADERS)) return false;
    seen.add(candidate);
    return true;
  });
}

/** The bundle for one locale. Evaluated on the first call and cached by Metro. */
export function loadLocale(locale: SupportedLocale): Bundle {
  return LOADERS[locale]();
}

/** Every locale that has a bundle of its own. */
export function loadableLocales(): SupportedLocale[] {
  return Object.keys(LOADERS) as SupportedLocale[];
}

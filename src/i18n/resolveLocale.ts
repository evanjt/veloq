import { LOCALE_FALLBACKS, type SupportedLocale } from './types';

const ROOT: SupportedLocale = 'en-GB';

const BY_LOWER_CASE = new Map(
  Object.entries(LOCALE_FALLBACKS).map(([tag, chain]) => [tag.toLowerCase(), chain])
);

/**
 * The locale the picker offers for a match the table names bare. Spanish with no
 * region is the Latin American variant, which is the Español row's default.
 */
function pickerSelectable(locale: SupportedLocale): SupportedLocale {
  return locale === 'es' ? 'es-419' : locale;
}

/**
 * The bundles to read, most specific first, for a list of language tags in the
 * order of preference. The first tag the app has a chain for decides, trying
 * the tag and then its language alone, and the locale it lands on is the
 * picker's variant for that match. A list that matches nothing reads en-GB.
 * Pure, so the app and the connect page resolve a tag the same way.
 */
export function resolveLocaleChain(languages: readonly string[]): SupportedLocale[] {
  for (const language of languages) {
    const tag = language.toLowerCase();
    const chain = BY_LOWER_CASE.get(tag) ?? BY_LOWER_CASE.get(tag.split('-')[0] ?? tag);
    if (chain) {
      const picked = pickerSelectable(chain[0]);
      return [...(LOCALE_FALLBACKS[picked] ?? chain)];
    }
  }
  return [ROOT];
}

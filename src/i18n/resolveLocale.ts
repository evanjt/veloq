import { LOCALE_FALLBACKS, type SupportedLocale } from './types';

const ROOT: SupportedLocale = 'en-GB';

const BY_LOWER_CASE = new Map(
  Object.entries(LOCALE_FALLBACKS).map(([tag, chain]) => [tag.toLowerCase(), chain])
);

/**
 * The bundles to read, most specific first, for a list of language tags in the
 * order of preference. The first tag the app has a chain for decides, trying
 * the tag and then its language alone; a list that matches nothing reads
 * en-GB. Pure, so the app and the connect page resolve a tag the same way.
 */
export function resolveLocaleChain(languages: readonly string[]): SupportedLocale[] {
  for (const language of languages) {
    const tag = language.toLowerCase();
    const chain = BY_LOWER_CASE.get(tag) ?? BY_LOWER_CASE.get(tag.split('-')[0] ?? tag);
    if (chain) return [...chain];
  }
  return [ROOT];
}

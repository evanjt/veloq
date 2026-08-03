/**
 * Store locale tables shared by validate-store-metadata.ts and
 * store-screenshots.ts. Play locale codes are the canonical keys because
 * supply uses the full form; Apple uses short codes for several of them.
 */

export interface LocaleMapping {
  app: string;
  android: string;
  ios: string;
}

// App i18n locale to store locale. de-CH variants collapse to de-DE because
// Swiss German is not a valid store locale on either platform.
export const LOCALE_MAPPINGS: LocaleMapping[] = [
  { app: 'en-US', android: 'en-US', ios: 'en-US' },
  { app: 'en-AU', android: 'en-AU', ios: 'en-AU' },
  { app: 'en-GB', android: 'en-GB', ios: 'en-GB' },
  { app: 'de-DE', android: 'de-DE', ios: 'de-DE' },
  { app: 'de-CH', android: 'de-DE', ios: 'de-DE' },
  { app: 'de-CHB', android: 'de-DE', ios: 'de-DE' },
  { app: 'de-CHZ', android: 'de-DE', ios: 'de-DE' },
  { app: 'es', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-ES', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-419', android: 'es-419', ios: 'es-MX' },
  { app: 'fr', android: 'fr-FR', ios: 'fr-FR' },
  { app: 'it', android: 'it-IT', ios: 'it' },
  { app: 'nl', android: 'nl-NL', ios: 'nl-NL' },
  { app: 'pt', android: 'pt-PT', ios: 'pt-PT' },
  { app: 'pt-BR', android: 'pt-BR', ios: 'pt-BR' },
  { app: 'pl', android: 'pl-PL', ios: 'pl' },
  { app: 'da', android: 'da-DK', ios: 'da' },
  { app: 'ja', android: 'ja-JP', ios: 'ja' },
  { app: 'zh-Hans', android: 'zh-CN', ios: 'zh-Hans' },
];

// Play locale to Apple locale where the codes diverge. Unlisted locales use
// the same code on both stores.
export const APPLE_LOCALE: Record<string, string> = {
  'da-DK': 'da',
  'es-419': 'es-MX',
  'it-IT': 'it',
  'ja-JP': 'ja',
  'pl-PL': 'pl',
  'zh-CN': 'zh-Hans',
};

// Byte-identical screenshot and description mirrors. Keyword fields are never
// mirrored: en-AU and en-GB are both indexed in the AU storefront, so
// identical keyword sets waste one of them.
export const MIRRORS: Record<string, string[]> = {
  'en-AU': ['en-GB'],
};

export function uniqueStoreLocales(platform: 'android' | 'ios'): string[] {
  return [...new Set(LOCALE_MAPPINGS.map((m) => m[platform]))];
}

export function appleLocaleFor(playLocale: string): string {
  return APPLE_LOCALE[playLocale] ?? playLocale;
}

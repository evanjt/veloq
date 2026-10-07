/**
 * Supported locales in the app
 * en-GB is the default language (standard English)
 */
export const SUPPORTED_LOCALES = [
  // English variants
  'en-AU',
  'en-US',
  'en-GB',
  // Spanish variants
  'es',
  'es-ES',
  'es-419',
  // French
  'fr',
  // German variants (including Swiss)
  'de-DE',
  'de-CH',
  // Dutch
  'nl',
  // Italian
  'it',
  // Portuguese variants
  'pt',
  'pt-BR',
  // Japanese
  'ja',
  // Chinese Simplified
  'zh-Hans',
  // Polish
  'pl',
  // Danish
  'da',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Fallback chain for locales
 * When a locale is not fully supported, fall back to these in order
 */
export const LOCALE_FALLBACKS: Record<string, SupportedLocale[]> = {
  // Australian English variants
  'en-AU': ['en-AU', 'en-GB'],
  'en-NZ': ['en-AU', 'en-GB'],

  // British English variants (use British spelling)
  'en-GB': ['en-GB'],
  'en-IE': ['en-GB'],
  'en-ZA': ['en-GB'],
  'en-IN': ['en-GB'],

  // American English variants
  'en-US': ['en-US', 'en-GB'],
  'en-CA': ['en-US', 'en-GB'],

  // Generic English -> British (standard English)
  en: ['en-GB'],

  // Spanish variants
  es: ['es', 'en-GB'],
  'es-ES': ['es-ES', 'es', 'en-GB'],
  'es-419': ['es-419', 'es', 'en-GB'],
  'es-MX': ['es-419', 'es', 'en-GB'],
  'es-AR': ['es-419', 'es', 'en-GB'],
  'es-CO': ['es-419', 'es', 'en-GB'],
  'es-CL': ['es-419', 'es', 'en-GB'],
  'es-PE': ['es-419', 'es', 'en-GB'],
  'es-VE': ['es-419', 'es', 'en-GB'],

  // French variants
  fr: ['fr', 'en-GB'],
  'fr-FR': ['fr', 'en-GB'],
  'fr-CA': ['fr', 'en-GB'],
  'fr-BE': ['fr', 'en-GB'],
  'fr-CH': ['fr', 'en-GB'],

  // German variants
  de: ['de-DE', 'en-GB'],
  'de-DE': ['de-DE', 'en-GB'],
  'de-AT': ['de-DE', 'en-GB'],
  'de-CH': ['de-CH', 'de-DE', 'en-GB'],

  // Dutch variants
  nl: ['nl', 'en-GB'],
  'nl-NL': ['nl', 'en-GB'],
  'nl-BE': ['nl', 'en-GB'],

  // Italian variants
  it: ['it', 'en-GB'],
  'it-IT': ['it', 'en-GB'],
  'it-CH': ['it', 'en-GB'],

  // Portuguese variants
  pt: ['pt', 'pt-BR', 'en-GB'],
  'pt-PT': ['pt', 'pt-BR', 'en-GB'],
  'pt-BR': ['pt-BR', 'pt', 'en-GB'],

  // Japanese
  ja: ['ja', 'en-GB'],
  'ja-JP': ['ja', 'en-GB'],

  // Chinese variants
  zh: ['zh-Hans', 'en-GB'],
  'zh-Hans': ['zh-Hans', 'en-GB'],
  'zh-CN': ['zh-Hans', 'en-GB'],
  'zh-SG': ['zh-Hans', 'en-GB'],

  // Polish
  pl: ['pl', 'en-GB'],
  'pl-PL': ['pl', 'en-GB'],

  // Danish
  da: ['da', 'en-GB'],
  'da-DK': ['da', 'en-GB'],
};

/** Key shape of every `t()` call, derived from the root locale bundle. */
export type TranslationResource = typeof import('./locales/en-GB.json');

/** Regional bundles may omit any branch inherited from their base locale. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Type for react-i18next
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: TranslationResource;
    };
  }
}

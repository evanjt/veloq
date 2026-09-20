import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import 'intl-pluralrules';

import { SUPPORTED_LOCALES, LOCALE_FALLBACKS, type SupportedLocale } from './types';

import { localesToLoad, loadLocale } from './localeBundles';

/**
 * Get the best matching locale from device settings
 */
export function getDeviceLocale(): SupportedLocale {
  const deviceLocales = getLocales();

  for (const locale of deviceLocales) {
    const tag = locale.languageTag; // e.g., 'en-AU', 'es-MX'
    const lang = locale.languageCode; // e.g., 'en', 'es'

    // Check for exact match first
    if (SUPPORTED_LOCALES.includes(tag as SupportedLocale)) {
      return tag as SupportedLocale;
    }

    // Check fallback chain
    if (tag in LOCALE_FALLBACKS) {
      return LOCALE_FALLBACKS[tag][0];
    }

    // Check language-only fallback
    if (lang && lang in LOCALE_FALLBACKS) {
      return LOCALE_FALLBACKS[lang][0];
    }
  }

  // Default to British English (standard English, not a dialect)
  return 'en-GB';
}

/**
 * The bundles one locale needs, as i18next's `resources` shape. Its own chain
 * and the root fallback, and none of the other fourteen.
 */
function resourcesFor(locale: string): Record<string, { translation: Record<string, unknown> }> {
  const resources: Record<string, { translation: Record<string, unknown> }> = {};
  for (const needed of localesToLoad(locale)) {
    resources[needed] = { translation: loadLocale(needed) };
  }
  return resources;
}

/**
 * Hand i18next the bundles for a locale it does not hold yet. Adding a bundle
 * it already has would re-evaluate nothing, but it would fire `added` and
 * re-render every subscriber, so the check is worth making.
 */
function ensureLocaleLoaded(locale: string): void {
  for (const needed of localesToLoad(locale)) {
    if (i18n.hasResourceBundle(needed, 'translation')) continue;
    i18n.addResourceBundle(needed, 'translation', loadLocale(needed), true, true);
  }
}

/**
 * Initialize i18n with the detected or saved locale
 */
export async function initializeI18n(savedLocale?: SupportedLocale | null): Promise<void> {
  const locale = savedLocale || getDeviceLocale();

  await i18n.use(initReactI18next).init({
    resources: resourcesFor(locale),
    lng: locale,
    fallbackLng: LOCALE_FALLBACKS[locale] || ['en-GB'],

    // Tell i18next which locales are valid
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    nonExplicitSupportedLngs: false,
    cleanCode: false,
    lowerCaseLng: false,

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added removed',
    },

    load: 'currentOnly',
    detection: undefined,
    returnNull: false,
    returnEmptyString: false,
  });
}

/**
 * Change the current language
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  const fallbacks = LOCALE_FALLBACKS[locale] || ['en-GB'];
  i18n.options.fallbackLng = fallbacks;
  // The bundles are loaded on demand, so the one being switched to has to be in
  // the store before the switch, or every key reads as itself.
  ensureLocaleLoaded(locale);
  await i18n.changeLanguage(locale);
}

/**
 * Get the current language
 */
export function getCurrentLanguage(): SupportedLocale {
  return i18n.language as SupportedLocale;
}

export { i18n };
export * from './types';

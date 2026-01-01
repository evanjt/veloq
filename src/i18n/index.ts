import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import 'intl-pluralrules';

import { SUPPORTED_LOCALES, LOCALE_FALLBACKS, type SupportedLocale } from './types';

// Import all locale files
import enAU from './locales/en-AU.json';
import enUS from './locales/en-US.json';
import enGB from './locales/en-GB.json';
import es from './locales/es.json';
import esES from './locales/es-ES.json';
import es419 from './locales/es-419.json';
import fr from './locales/fr.json';
import deDE from './locales/de-DE.json';
import deCH from './locales/de-CH.json';
import deCHZ from './locales/de-CHZ.json';
import deCHB from './locales/de-CHB.json';
import nl from './locales/nl.json';
import it from './locales/it.json';
import pt from './locales/pt.json';
import ptBR from './locales/pt-BR.json';
import ja from './locales/ja.json';
import zhHans from './locales/zh-Hans.json';
import pl from './locales/pl.json';
import da from './locales/da.json';

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

  // Default to Australian English
  return 'en-AU';
}

/**
 * Resources for all supported locales
 */
const resources = {
  'en-AU': { translation: enAU },
  'en-US': { translation: enUS },
  'en-GB': { translation: enGB },
  es: { translation: es },
  'es-ES': { translation: esES },
  'es-419': { translation: es419 },
  fr: { translation: fr },
  'de-DE': { translation: deDE },
  'de-CH': { translation: deCH },
  'de-CHZ': { translation: deCHZ },
  'de-CHB': { translation: deCHB },
  nl: { translation: nl },
  it: { translation: it },
  pt: { translation: pt },
  'pt-BR': { translation: ptBR },
  ja: { translation: ja },
  'zh-Hans': { translation: zhHans },
  pl: { translation: pl },
  da: { translation: da },
};

/**
 * Initialize i18n with the detected or saved locale
 */
export async function initializeI18n(savedLocale?: SupportedLocale | null): Promise<void> {
  const locale = savedLocale || getDeviceLocale();

  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en-AU',

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React Native doesn't need HTML escaping
    react: {
      useSuspense: false,
    },

    // Return key if translation is missing (for development)
    returnNull: false,
    returnEmptyString: false,
  });
}

/**
 * Change the current language
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
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

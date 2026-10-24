import { getCurrentLanguage } from '@/i18n';
import { ROOT_LOCALE } from '@/i18n/localeBundles';

/**
 * Map app locale codes to valid Intl/BCP 47 locale codes for date and number formatting.
 *
 * Some locales have custom codes that don't match standard BCP 47 format.
 * This function maps them to valid locale codes for use with Intl.DateTimeFormat and Intl.NumberFormat.
 *
 * ```ts
 * getIntlLocale(); // "zh-CN" for "zh-Hans"
 * ```
 */
export function getIntlLocale(): string {
  // Before i18n is initialised the language is undefined, and Intl would read the host's locale.
  const locale = getCurrentLanguage() || ROOT_LOCALE;

  // Map custom locale codes to valid Intl codes
  const localeMap: Record<string, string> = {
    'zh-Hans': 'zh-CN', // Simplified Chinese script → China region
  };

  return localeMap[locale] || locale;
}

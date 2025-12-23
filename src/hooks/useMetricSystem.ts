import { getLocales } from 'expo-localization';

/**
 * Check if user's locale uses metric system
 * Returns true for metric, false for imperial (US, Liberia, Myanmar)
 */
export function useMetricSystem(): boolean {
  try {
    const locales = getLocales();
    const locale = locales[0];
    const imperialCountries = ['US', 'LR', 'MM'];
    return !imperialCountries.includes(locale?.regionCode || '');
  } catch {
    return true;
  }
}

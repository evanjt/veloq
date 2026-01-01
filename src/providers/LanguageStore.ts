import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { SUPPORTED_LOCALES, type SupportedLocale, getDeviceLocale, changeLanguage } from '@/i18n';

const STORAGE_KEY = 'veloq-language-preference';

/** Simplified language choice - 'en', 'es', 'fr', or null for system */
type LanguageChoice = string | null;

interface LanguageState {
  /** Current language choice. null means 'system' (auto-detect) */
  language: LanguageChoice;
  /** Whether the store has been initialized */
  isInitialized: boolean;
  /** Set a language choice or null for system default */
  setLanguage: (language: LanguageChoice) => Promise<void>;
}

/**
 * Map a simplified language choice to the appropriate locale
 * For English, uses device region to pick the right variant (AU/US/UK)
 */
export function resolveLanguageToLocale(language: LanguageChoice): SupportedLocale {
  if (language === null) {
    return getDeviceLocale();
  }

  // Direct locale values (e.g., 'en-AU', 'de-CH', 'pt-BR')
  if (SUPPORTED_LOCALES.includes(language as SupportedLocale)) {
    return language as SupportedLocale;
  }

  // Language-only values - resolve to best variant
  if (language === 'en') {
    const deviceLocale = getDeviceLocale();
    if (deviceLocale.startsWith('en-')) {
      return deviceLocale;
    }
    return 'en-AU';
  }

  if (language === 'de') return 'de-DE';
  if (language === 'es') return 'es';
  if (language === 'fr') return 'fr';
  if (language === 'nl') return 'nl';
  if (language === 'it') return 'it';
  if (language === 'pt') return 'pt-BR'; // Default to Brazilian Portuguese
  if (language === 'ja') return 'ja';
  if (language === 'zh') return 'zh-Hans';
  if (language === 'pl') return 'pl';
  if (language === 'da') return 'da';

  // Unknown language, default to English
  return 'en-AU';
}

/**
 * Zustand store for language preference
 */
export const useLanguageStore = create<LanguageState>((set) => ({
  language: null,
  isInitialized: false,

  setLanguage: async (language) => {
    // Save preference (can be 'en', 'es', 'fr', or null for system)
    if (language === null) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, language);
    }

    // Resolve to the appropriate locale (handles English variants based on device region)
    const effectiveLocale = resolveLanguageToLocale(language);
    await changeLanguage(effectiveLocale);

    set({ language });
  },
}));

/**
 * Initialize language on app start.
 * Call this early in _layout.tsx before rendering.
 */
export async function initializeLanguage(): Promise<SupportedLocale> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);

    if (saved) {
      // Handle both old full locale values and new simplified values
      useLanguageStore.setState({ language: saved, isInitialized: true });
      return resolveLanguageToLocale(saved);
    }

    // No saved preference - use system locale
    useLanguageStore.setState({ language: null, isInitialized: true });
    return getDeviceLocale();
  } catch {
    useLanguageStore.setState({ language: null, isInitialized: true });
    return getDeviceLocale();
  }
}

/**
 * Get the current effective language (saved or system)
 */
export function getEffectiveLanguage(): SupportedLocale {
  const { language } = useLanguageStore.getState();
  return resolveLanguageToLocale(language);
}

/**
 * Language option for UI
 */
type LanguageOption = {
  value: string | null;
  label: string;
  description?: string;
  /** Sub-options for regional variants (e.g., English regional variants) */
  variants?: Array<{ value: string; label: string }>;
};

/**
 * Language group for organized UI display
 */
export type LanguageGroup = {
  /** Translation key for the group label, null for ungrouped (System) */
  groupLabel: string | null;
  languages: LanguageOption[];
};

/**
 * Get language options for settings UI
 * Languages are listed alphabetically with System option first
 */
export function getAvailableLanguages(): LanguageGroup[] {
  return [
    {
      groupLabel: null,
      languages: [
        { value: null, label: 'System', description: 'Auto-detect from device' },
        { value: 'da', label: 'Dansk' },
        {
          value: 'de',
          label: 'Deutsch',
          variants: [
            { value: 'de-DE', label: 'DE' },
            { value: 'de-CH', label: 'CH' },
            { value: 'de-CHZ', label: 'Züri' },
            { value: 'de-CHB', label: 'Bärn' },
          ],
        },
        {
          value: 'en',
          label: 'English',
          variants: [
            { value: 'en-AU', label: 'AU' },
            { value: 'en-GB', label: 'GB' },
            { value: 'en-US', label: 'US' },
          ],
        },
        {
          value: 'es',
          label: 'Español',
          variants: [
            { value: 'es-ES', label: 'ES' },
            { value: 'es-419', label: 'LATAM' },
          ],
        },
        { value: 'fr', label: 'Français' },
        { value: 'it', label: 'Italiano' },
        { value: 'nl', label: 'Nederlands' },
        { value: 'pl', label: 'Polski' },
        {
          value: 'pt',
          label: 'Português',
          variants: [
            { value: 'pt', label: 'PT' },
            { value: 'pt-BR', label: 'BR' },
          ],
        },
        { value: 'ja', label: '日本語' },
        { value: 'zh-Hans', label: '中文' },
      ],
    },
  ];
}

/**
 * Get flat list of language options (for backwards compatibility)
 */
export function getAvailableLanguagesFlat(): LanguageOption[] {
  const groups = getAvailableLanguages();
  return groups.flatMap((group) => group.languages);
}

/**
 * Check if a language value is an English variant
 */
export function isEnglishVariant(language: string | null): boolean {
  return language === 'en' || (language !== null && language.startsWith('en-'));
}

/**
 * Get the display value for English variants (for UI highlighting)
 * Resolves 'en' to the device's regional variant
 */
export function getEnglishVariantValue(language: string | null): string {
  if (language === null) {
    const deviceLocale = getDeviceLocale();
    return deviceLocale.startsWith('en-') ? deviceLocale : 'en-AU';
  }
  if (language === 'en') {
    // Resolve to device's regional variant
    const deviceLocale = getDeviceLocale();
    return deviceLocale.startsWith('en-') ? deviceLocale : 'en-AU';
  }
  if (language.startsWith('en-')) return language;
  return 'en-AU';
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  getDeviceLocale,
  changeLanguage,
} from '@/i18n';

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

  if (language === 'en') {
    // For English, check device region to pick the right variant
    const deviceLocale = getDeviceLocale();
    if (deviceLocale.startsWith('en-')) {
      return deviceLocale;
    }
    return 'en-AU';
  }

  if (language === 'es') return 'es';
  if (language === 'fr') return 'fr';

  // If it's already a full locale (legacy), use it directly
  if (SUPPORTED_LOCALES.includes(language as SupportedLocale)) {
    return language as SupportedLocale;
  }

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
 * Get simplified language options
 * English variants are combined - device region determines which variant to use
 */
export function getAvailableLanguages(): LanguageOption[] {
  return [
    { value: null, label: 'System', description: 'Auto-detect from device' },
    {
      value: 'en',
      label: 'English',
      variants: [
        { value: 'en-AU', label: 'AU' },
        { value: 'en-GB', label: 'GB' },
        { value: 'en-US', label: 'US' },
      ],
    },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
  ];
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

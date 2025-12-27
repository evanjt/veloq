import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  type SupportedLocale,
  getDeviceLocale,
  changeLanguage,
} from '@/i18n';

const STORAGE_KEY = 'veloq-language-preference';

interface LanguageState {
  /** Current language. null means 'system' (auto-detect) */
  language: SupportedLocale | null;
  /** Whether the store has been initialized */
  isInitialized: boolean;
  /** Set a specific language or null for system default */
  setLanguage: (language: SupportedLocale | null) => Promise<void>;
}

/**
 * Zustand store for language preference
 */
export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: null,
  isInitialized: false,

  setLanguage: async (language) => {
    // Save preference
    if (language === null) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, language);
    }

    // Update i18n
    const effectiveLanguage = language || getDeviceLocale();
    await changeLanguage(effectiveLanguage);

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

    if (saved && SUPPORTED_LOCALES.includes(saved as SupportedLocale)) {
      useLanguageStore.setState({ language: saved as SupportedLocale, isInitialized: true });
      return saved as SupportedLocale;
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
  return language || getDeviceLocale();
}

/**
 * Get all available languages with display names
 */
export function getAvailableLanguages(): { value: SupportedLocale | null; label: string }[] {
  return [
    { value: null, label: 'System' },
    ...SUPPORTED_LOCALES.map((locale) => ({
      value: locale,
      label: LOCALE_DISPLAY_NAMES[locale],
    })),
  ];
}

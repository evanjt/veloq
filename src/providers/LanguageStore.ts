import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  getDeviceLocale,
  changeLanguage,
  i18n,
} from '@/i18n';
import { getRouteEngine } from '@/lib/native/routeEngine';

const STORAGE_KEY = 'veloq-language-preference';

/** Language choice - always an explicit locale (no 'system' option) */
type LanguageChoice = string;

interface LanguageState {
  /** Current language choice (explicit locale) */
  language: LanguageChoice | null; // null only before initialization
  /** Whether the store has been initialized */
  isInitialized: boolean;
  /** Set a language choice */
  setLanguage: (language: LanguageChoice) => Promise<void>;
}

/**
 * Map a language choice to the appropriate locale
 * For English, uses device region to pick the right variant (AU/US/UK)
 */
export function resolveLanguageToLocale(language: LanguageChoice | null): SupportedLocale {
  if (language === null) {
    // Pre-initialization state - use device locale
    return getDeviceLocale();
  }

  // Direct locale values (e.g., 'en-AU', 'de-CH', 'pt-BR')
  if (SUPPORTED_LOCALES.includes(language as SupportedLocale)) {
    return language as SupportedLocale;
  }

  // Language-only values - resolve to default variant
  // These match the defaultVariant in getAvailableLanguages()
  if (language === 'en') return 'en-GB';
  if (language === 'de') return 'de-DE';
  if (language === 'es') return 'es-419'; // LATAM
  if (language === 'pt') return 'pt-BR';
  if (language === 'fr') return 'fr';
  if (language === 'nl') return 'nl';
  if (language === 'it') return 'it';
  if (language === 'ja') return 'ja';
  if (language === 'zh') return 'zh-Hans';
  if (language === 'pl') return 'pl';
  if (language === 'da') return 'da';

  // Unknown language, default to British English
  return 'en-GB';
}

/**
 * Zustand store for language preference
 */
export const useLanguageStore = create<LanguageState>((set) => ({
  language: null,
  isInitialized: false,

  setLanguage: async (language) => {
    // Save preference (always an explicit locale)
    await AsyncStorage.setItem(STORAGE_KEY, language);

    // Resolve to the appropriate locale (handles English variants based on device region)
    const effectiveLocale = resolveLanguageToLocale(language);
    await changeLanguage(effectiveLocale);

    // Update Rust engine with new translations for auto-generated names
    const engine = getRouteEngine();
    if (engine) {
      const routeWord = i18n.t('routes.routeWord');
      const sectionWord = i18n.t('routes.sectionWord');
      engine.setNameTranslations(routeWord, sectionWord);
    }

    set({ language });
  },
}));

/**
 * Initialize language on app start.
 * Call this early in _layout.tsx before rendering.
 * On first launch, detects device locale and saves it as the explicit choice.
 */
export async function initializeLanguage(): Promise<SupportedLocale> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);

    if (saved) {
      // Handle both old full locale values and new simplified values
      useLanguageStore.setState({ language: saved, isInitialized: true });
      return resolveLanguageToLocale(saved);
    }

    // No saved preference - detect device locale and save it as explicit choice
    const deviceLocale = getDeviceLocale();
    await AsyncStorage.setItem(STORAGE_KEY, deviceLocale);
    useLanguageStore.setState({ language: deviceLocale, isInitialized: true });
    return deviceLocale;
  } catch {
    // On error, still try to detect and save device locale
    const deviceLocale = getDeviceLocale();
    useLanguageStore.setState({ language: deviceLocale, isInitialized: true });
    return deviceLocale;
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
 * Language variant with optional dialect flag
 */
export type LanguageVariant = {
  value: string;
  label: string;
  /** Mark as dialect/fun variant (shows gold dotted border in UI) */
  isDialect?: boolean;
};

/**
 * Language option for UI
 */
type LanguageOption = {
  value: string;
  label: string;
  description?: string;
  /** Sub-options for regional variants (e.g., English regional variants) */
  variants?: LanguageVariant[];
  /** Default variant to use when clicking the language row (first variant if not specified) */
  defaultVariant?: string;
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
 * Languages are listed alphabetically
 */
export function getAvailableLanguages(): LanguageGroup[] {
  return [
    {
      groupLabel: null,
      languages: [
        { value: 'da', label: 'Dansk' },
        {
          value: 'de',
          label: 'Deutsch',
          defaultVariant: 'de-DE',
          variants: [
            { value: 'de-DE', label: 'DE' },
            { value: 'de-CH', label: 'CH', isDialect: true },
          ],
        },
        {
          value: 'en',
          label: 'English',
          defaultVariant: 'en-GB',
          variants: [
            { value: 'en-GB', label: 'GB' },
            { value: 'en-US', label: 'US' },
            { value: 'en-AU', label: 'AU', isDialect: true },
          ],
        },
        {
          value: 'es',
          label: 'Español',
          defaultVariant: 'es-419',
          variants: [
            { value: 'es-419', label: 'LATAM' },
            { value: 'es-ES', label: 'ES' },
          ],
        },
        { value: 'fr', label: 'Français' },
        { value: 'it', label: 'Italiano' },
        { value: 'nl', label: 'Nederlands' },
        { value: 'pl', label: 'Polski' },
        {
          value: 'pt',
          label: 'Português',
          defaultVariant: 'pt-BR',
          variants: [
            { value: 'pt-BR', label: 'BR' },
            { value: 'pt', label: 'PT' },
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
    return deviceLocale.startsWith('en-') ? deviceLocale : 'en-GB';
  }
  if (language === 'en') {
    // Resolve to device's regional variant
    const deviceLocale = getDeviceLocale();
    return deviceLocale.startsWith('en-') ? deviceLocale : 'en-GB';
  }
  if (language.startsWith('en-')) return language;
  return 'en-GB';
}

/**
 * Check if a language value belongs to a specific language family
 */
export function isLanguageVariant(language: string | null, baseLanguage: string): boolean {
  if (language === null) return false;
  if (language === baseLanguage) return true;
  return language.startsWith(`${baseLanguage}-`);
}

/**
 * Get the base language code from a locale (e.g., 'de-CH' -> 'de')
 */
export function getBaseLanguage(language: string | null): string | null {
  if (language === null) return null;
  const parts = language.split('-');
  return parts[0];
}

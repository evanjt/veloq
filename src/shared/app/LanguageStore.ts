import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { getSetting, setSetting } from '@/shared/storage';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  getDeviceLocale,
  matchLocale,
  changeLanguage,
  i18n,
} from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { pushNotificationTemplates } from '@/i18n/notificationTemplates';
import { pushPlaceNameWords } from '@/i18n/placeNameWords';
import { readPlatformLanguage, readSystemLocales, writePlatformLanguage } from './appLocale';

const STORAGE_KEY = 'veloq-language-preference';

/** The stored choice that follows the phone's language rather than naming one. */
export const SYSTEM_LANGUAGE = 'system';

/**
 * Set once an install has moved a first-launch detection to SYSTEM_LANGUAGE.
 * Its absence marks an install that has not yet run this code, whose saved
 * language may be the phone's, saved at its first launch, rather than a pick.
 */
const FOLLOWS_SYSTEM_CHECKED_KEY = 'veloq-language-follows-system-checked';

/**
 * The per-app language tag this install last agreed with the platform, or
 * SYSTEM_LANGUAGE for none, since an empty value reads back as absent. It
 * describes this device, so it lives in AsyncStorage beside the other
 * device-local bookkeeping and never travels in a backup, and it is read only
 * where the platform keeps a per-app language.
 */
const PLATFORM_AGREED_KEY = 'veloq-language-platform-agreed';

/** Language choice: 'system', or an explicit locale. */
type LanguageChoice = string;

interface LanguageState {
  /** Current language choice */
  language: LanguageChoice | null; // null only before initialisation
  /** Whether the store has been initialised */
  isInitialised: boolean;
  /** Set a language choice */
  setLanguage: (language: LanguageChoice) => Promise<void>;
}

/**
 * The phone's language. Where the platform keeps a per-app language, the
 * process locale is that one rather than the phone's, so the phone's own list
 * is read instead.
 */
function systemLocale(): SupportedLocale {
  const system = readSystemLocales();
  if (system && system.length > 0) {
    return matchLocale(system.map((languageTag) => ({ languageTag })));
  }
  return getDeviceLocale();
}

/**
 * Map a language choice to the appropriate locale
 * For English, uses device region to pick the right variant (AU/US/UK)
 */
export function resolveLanguageToLocale(language: LanguageChoice | null): SupportedLocale {
  if (language === null || language === SYSTEM_LANGUAGE) {
    // Pre-initialisation state, or following the phone
    return systemLocale();
  }

  // Direct locale values (e.g., 'en-AU', 'de-CH', 'pt-BR')
  if (SUPPORTED_LOCALES.includes(language as SupportedLocale)) {
    return language as SupportedLocale;
  }

  // Language-only values that are not themselves supported locales: only
  // en, de and zh reach here, and resolve to their default variant
  if (language === 'en') return 'en-GB';
  if (language === 'de') return 'de-DE';
  if (language === 'zh') return 'zh-Hans';

  // Unknown language, default to British English
  return 'en-GB';
}

/** The per-app language the platform holds for a choice: none when it follows the phone. */
function platformTagFor(language: LanguageChoice): string {
  return language === SYSTEM_LANGUAGE ? '' : resolveLanguageToLocale(language);
}

/** The choice a per-app language set in the platform's own settings stands for. */
function choiceForPlatformTag(tag: string): LanguageChoice {
  return tag === '' ? SYSTEM_LANGUAGE : matchLocale([{ languageTag: tag }]);
}

/** The per-app language tag this install last agreed with the platform, null before the first. */
async function readAgreedTag(): Promise<string | null> {
  const agreed = await AsyncStorage.getItem(PLATFORM_AGREED_KEY);
  return agreed === SYSTEM_LANGUAGE ? '' : agreed;
}

async function rememberAgreedTag(tag: string): Promise<void> {
  await AsyncStorage.setItem(PLATFORM_AGREED_KEY, tag === '' ? SYSTEM_LANGUAGE : tag);
}

/** Write the choice to the platform's per-app language, where there is one, and remember it. */
async function agreeWithPlatform(language: LanguageChoice): Promise<void> {
  const platform = readPlatformLanguage();
  if (platform === null) return;
  const tag = platformTagFor(language);
  if (platform !== tag) writePlatformLanguage(tag);
  await rememberAgreedTag(tag);
}

/**
 * The choice once the platform has had its say. A per-app language that moved
 * since this install last wrote one was picked in the platform's settings, and
 * is adopted; otherwise the stored choice is written to the platform, which
 * also carries a restored or first-migrated choice there.
 */
async function reconcileWithPlatform(language: LanguageChoice): Promise<LanguageChoice> {
  const platform = readPlatformLanguage();
  if (platform === null) return language;
  const agreed = await readAgreedTag();
  if (agreed !== null && platform !== agreed) {
    const adopted = choiceForPlatformTag(platform);
    await setSetting(STORAGE_KEY, adopted);
    await rememberAgreedTag(platform);
    return adopted;
  }
  if (agreed === null || platform !== platformTagFor(language)) {
    await agreeWithPlatform(language);
  }
  return language;
}

/** Switch every reader of the language: i18next, the engine's words and the durable templates. */
async function applyLanguage(language: LanguageChoice): Promise<void> {
  await changeLanguage(resolveLanguageToLocale(language));

  // Update Rust engine with new translations for auto-generated names
  const engine = getEngine();
  if (engine) {
    const routeWord = i18n.t('routes.routeWord');
    const sectionWord = i18n.t('routes.sectionWord');
    engine.setNameTranslations(routeWord, sectionWord);
  }

  // The notification templates go with them, so a push handler woken with
  // the app killed writes its sentence in the language just chosen. Unlike
  // the two words above these are durable, which is the whole point. The
  // place name words are durable for the same reason.
  pushNotificationTemplates();
  pushPlaceNameWords();

  useLanguageStore.setState({ language });
}

/**
 * Zustand store for language preference
 */
export const useLanguageStore = create<LanguageState>(() => ({
  language: null,
  isInitialised: false,

  setLanguage: async (language) => {
    await setSetting(STORAGE_KEY, language);
    await agreeWithPlatform(language);
    await applyLanguage(language);
  },
}));

/**
 * Initialise language on app start.
 * Call this early in _layout.tsx before rendering.
 * A first launch follows the phone. An install that saved the phone's language
 * as its first-launch detection moves to following it, once; a saved language
 * that differs from the phone was picked, and stays.
 */
export async function initialiseLanguage(): Promise<SupportedLocale> {
  try {
    const saved = await getSetting(STORAGE_KEY);

    // Neutral 'es' has no picker entry, so installs that saved it move to the default variant
    let language = saved === null ? SYSTEM_LANGUAGE : saved === 'es' ? 'es-419' : saved;
    const unchecked = (await getSetting(FOLLOWS_SYSTEM_CHECKED_KEY)) === null;
    if (unchecked && language === systemLocale()) language = SYSTEM_LANGUAGE;
    if (language !== saved) await setSetting(STORAGE_KEY, language);
    if (unchecked) await setSetting(FOLLOWS_SYSTEM_CHECKED_KEY, '1');

    language = await reconcileWithPlatform(language);
    useLanguageStore.setState({ language, isInitialised: true });
    return resolveLanguageToLocale(language);
  } catch {
    useLanguageStore.setState({ language: SYSTEM_LANGUAGE, isInitialised: true });
    return systemLocale();
  }
}

/**
 * Bring the language in step with the phone and the platform's per-app
 * setting, either of which can change while the app is in the background.
 */
export async function followPlatformLanguage(): Promise<void> {
  const { language, isInitialised } = useLanguageStore.getState();
  if (!isInitialised || language === null) return;
  const next = await reconcileWithPlatform(language);
  if (next !== language || resolveLanguageToLocale(next) !== i18n.language) {
    await applyLanguage(next);
  }
}

/** Re-read the language each time the app comes back to the foreground. */
export function startLanguageFollower(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    followPlatformLanguage().catch((error: unknown) => {
      console.warn('[Language] could not follow the platform language:', error);
    });
  });
  return () => subscription.remove();
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
 * Display label for a stored language code, with whether it is a dialect choice.
 * A variant reads "English (AU)"; a code matching only by prefix reads as its base language.
 * Following the phone reads "System · " and the phone's language.
 */
export function languageLabel(language: string | null): { label: string; isDialect: boolean } {
  if (language === SYSTEM_LANGUAGE) {
    return {
      label: `${i18n.t('settings.system')} · ${languageLabel(systemLocale()).label}`,
      isDialect: false,
    };
  }
  for (const group of getAvailableLanguages()) {
    for (const lang of group.languages) {
      if (language === lang.value) return { label: lang.label, isDialect: false };
      const variant = lang.variants?.find((v) => v.value === language);
      if (variant) {
        return { label: `${lang.label} (${variant.label})`, isDialect: variant.isDialect ?? false };
      }
      if (isLanguageVariant(language, lang.value)) return { label: lang.label, isDialect: false };
    }
  }
  return { label: 'English', isDialect: false };
}

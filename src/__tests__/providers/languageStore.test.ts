/**
 * LanguageStore Tests
 *
 * Focus: Bug-catching edge cases over coverage metrics
 * Uses real i18next integration (not mocked) to catch configuration bugs.
 *
 * - Locale resolution logic
 * - Swiss dialect handling
 * - Language-only vs full locale
 * - First launch detection
 * - English variant edge cases
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import {
  useLanguageStore,
  initializeLanguage,
  resolveLanguageToLocale,
  getAvailableLanguages,
  getEnglishVariantValue,
  isEnglishVariant,
  isLanguageVariant,
} from '@/shared/app/LanguageStore';

const STORAGE_KEY = 'veloq-language-preference';
const mockGetLocales = Localization.getLocales as jest.Mock;

describe('LanguageStore', () => {
  beforeEach(async () => {
    // Reset store to initial state
    useLanguageStore.setState({
      language: null,
      isInitialized: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();

    // Reset device locale to default
    mockGetLocales.mockReturnValue([
      { languageTag: 'en-US', languageCode: 'en', regionCode: 'US' },
    ]);
  });

  // ============================================================
  // LOCALE RESOLUTION LOGIC
  // ============================================================

  describe('resolveLanguageToLocale()', () => {
    it('returns device locale when language is null', () => {
      mockGetLocales.mockReturnValue([
        { languageTag: 'de-DE', languageCode: 'de', regionCode: 'DE' },
      ]);

      const result = resolveLanguageToLocale(null);
      expect(result).toBe('de-DE');
    });

    it('returns en-GB for unknown language', () => {
      expect(resolveLanguageToLocale('xyz')).toBe('en-GB');
      expect(resolveLanguageToLocale('invalid-locale')).toBe('en-GB');
      expect(resolveLanguageToLocale('')).toBe('en-GB');
    });
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initializeLanguage()', () => {
    it('loads saved preference from AsyncStorage', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'de-CH');

      const result = await initializeLanguage();

      expect(result).toBe('de-CH');
      expect(useLanguageStore.getState().language).toBe('de-CH');
      expect(useLanguageStore.getState().isInitialized).toBe(true);
    });

    it('detects device locale on first launch and saves it', async () => {
      mockGetLocales.mockReturnValue([
        { languageTag: 'en-AU', languageCode: 'en', regionCode: 'AU' },
      ]);

      const result = await initializeLanguage();

      expect(result).toBe('en-AU');
      expect(useLanguageStore.getState().language).toBe('en-AU');

      // Should have saved to AsyncStorage
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      expect(saved).toBe('en-AU');
    });

    it('handles language-only saved values (old format)', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'de');

      const result = await initializeLanguage();

      // 'de' is not a full locale - resolves to 'de-DE' via fallback
      expect(result).toBe('de-DE');
      expect(useLanguageStore.getState().language).toBe('de');
    });
  });

  // ============================================================
  // ENGLISH VARIANT HANDLING
  // ============================================================

  describe('English Variant Functions', () => {
    describe('isEnglishVariant()', () => {
      it('returns true for English values', () => {
        expect(isEnglishVariant('en')).toBe(true);
        expect(isEnglishVariant('en-US')).toBe(true);
        expect(isEnglishVariant('en-AU')).toBe(true);
        expect(isEnglishVariant('en-GB')).toBe(true);
      });

      it('returns false for non-English values', () => {
        expect(isEnglishVariant('de')).toBe(false);
        expect(isEnglishVariant('de-CH')).toBe(false);
        expect(isEnglishVariant('fr')).toBe(false);
        expect(isEnglishVariant(null)).toBe(false);
      });
    });

    describe('getEnglishVariantValue()', () => {
      it('returns device locale for null when device is English', () => {
        mockGetLocales.mockReturnValue([
          { languageTag: 'en-AU', languageCode: 'en', regionCode: 'AU' },
        ]);

        expect(getEnglishVariantValue(null)).toBe('en-AU');
      });

      it('returns en-GB for null when device is non-English', () => {
        mockGetLocales.mockReturnValue([
          { languageTag: 'de-DE', languageCode: 'de', regionCode: 'DE' },
        ]);

        expect(getEnglishVariantValue(null)).toBe('en-GB');
      });

      it('resolves "en" to device regional variant', () => {
        mockGetLocales.mockReturnValue([
          { languageTag: 'en-AU', languageCode: 'en', regionCode: 'AU' },
        ]);

        expect(getEnglishVariantValue('en')).toBe('en-AU');
      });
    });
  });

  // ============================================================
  // LANGUAGE VARIANT HELPERS
  // ============================================================

  describe('isLanguageVariant()', () => {
    it('matches regional variants', () => {
      expect(isLanguageVariant('de-CH', 'de')).toBe(true);
      expect(isLanguageVariant('en-AU', 'en')).toBe(true);
      expect(isLanguageVariant('pt-BR', 'pt')).toBe(true);
    });

    it('returns false for non-matching languages', () => {
      expect(isLanguageVariant('de-CH', 'en')).toBe(false);
      expect(isLanguageVariant('fr', 'de')).toBe(false);
    });
  });

  // ============================================================
  // AVAILABLE LANGUAGES
  // ============================================================

  describe('getAvailableLanguages()', () => {
    it('includes German with Swiss dialect variants', () => {
      const groups = getAvailableLanguages();
      const german = groups[0].languages.find((l) => l.value === 'de');

      expect(german?.variants?.some((v) => v.value === 'de-CH')).toBe(true);
    });
  });

  // ============================================================
  // DEVICE LOCALE MAPPING
  // ============================================================

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('Edge Cases', () => {
    it('handles empty locales array from device', () => {
      mockGetLocales.mockReturnValue([]);

      // Should not crash and use fallback
      const result = resolveLanguageToLocale(null);
      expect(result).toBeDefined();
    });
  });
});

describe('device locales reach a selectable picker entry', () => {
  const selectedEntries = (language: string): number => {
    const rows = getAvailableLanguages().flatMap((group) => group.languages);
    let selected = 0;
    for (const row of rows) {
      if (row.variants) {
        selected += row.variants.filter((variant) => variant.value === language).length;
      } else if (row.value === language) {
        selected += 1;
      }
    }
    return selected;
  };

  const deviceTags: [string, string][] = [
    ['es-US', 'es'],
    ['es-UY', 'es'],
    ['es-EC', 'es'],
    ['es-CR', 'es'],
    ['es-BO', 'es'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es-ES', 'es'],
    ['en-NZ', 'en'],
    ['pt-PT', 'pt'],
    ['pt-BR', 'pt'],
    ['de-AT', 'de'],
    ['de-CH', 'de'],
    ['fr-CA', 'fr'],
    ['zh-Hans-CN', 'zh'],
  ];

  it.each(deviceTags)(
    '%s saves a value the picker can select',
    async (languageTag, languageCode) => {
      (Localization.getLocales as jest.Mock).mockReturnValue([{ languageTag, languageCode }]);
      useLanguageStore.setState({ language: null, isInitialized: false });
      await AsyncStorage.clear();

      await initializeLanguage();

      expect(selectedEntries(useLanguageStore.getState().language as string)).toBe(1);
    }
  );

  it('migrates a saved neutral es to the Español default variant', async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, 'es');
    useLanguageStore.setState({ language: null, isInitialized: false });

    const locale = await initializeLanguage();

    expect(locale).toBe('es-419');
    expect(useLanguageStore.getState().language).toBe('es-419');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('es-419');
  });
});

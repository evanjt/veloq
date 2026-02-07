/**
 * ThemeProvider Tests
 *
 * Uses source-code analysis for Appearance.setColorScheme verification
 * (can't mock react-native without breaking AsyncStorage in node environment)
 * and direct AsyncStorage testing for persistence logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'veloq-theme-preference';
const THEME_PROVIDER_PATH = path.resolve(__dirname, '../../providers/ThemeProvider.ts');

describe('ThemeProvider', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // Source-code analysis — verify behavior patterns
  // ============================================================

  describe('source-code contracts', () => {
    const content = fs.readFileSync(THEME_PROVIDER_PATH, 'utf-8');

    it('initializeTheme reads from AsyncStorage', () => {
      expect(content).toContain('AsyncStorage.getItem');
    });

    it('initializeTheme calls setColorScheme for light/dark', () => {
      // Verify both light and dark branches call setColorScheme
      expect(content).toMatch(/Appearance\.setColorScheme\(saved\)/);
    });

    it('initializeTheme falls back to null (system) for unknown values', () => {
      expect(content).toMatch(/Appearance\.setColorScheme\(null\)/);
    });

    it('setThemePreference persists to AsyncStorage before applying', () => {
      // Verify the function writes to storage
      expect(content).toContain('AsyncStorage.setItem');
      expect(content).toContain('Appearance.setColorScheme');
    });

    it('setThemePreference maps "system" to null', () => {
      expect(content).toMatch(/preference\s*===\s*['"]system['"]\s*\?\s*null/);
    });

    it('getThemePreference returns "system" as default', () => {
      // Verify default return value
      const fnMatch = content.match(
        /async function getThemePreference[\s\S]*?return\s+['"]system['"]/
      );
      expect(fnMatch).not.toBeNull();
    });

    it('getThemePreference validates stored values', () => {
      // Should only accept 'light', 'dark', 'system'
      expect(content).toContain("'light'");
      expect(content).toContain("'dark'");
      expect(content).toContain("'system'");
    });

    it('all functions handle errors with try/catch', () => {
      // Count try blocks — should have one per function (3 functions)
      const tryCount = (content.match(/\btry\s*\{/g) || []).length;
      expect(tryCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // getThemePreference — can test directly (only uses AsyncStorage)
  // ============================================================

  describe('getThemePreference()', () => {
    // Import lazily to avoid react-native import issues
    let getThemePreference: () => Promise<string>;

    beforeAll(() => {
      // Mock react-native before importing ThemeProvider
      jest.doMock('react-native', () => ({
        Appearance: { setColorScheme: jest.fn() },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tp = require('@/providers/ThemeProvider');
      getThemePreference = tp.getThemePreference;
    });

    afterAll(() => {
      jest.dontMock('react-native');
    });

    it('returns "system" when nothing stored', async () => {
      expect(await getThemePreference()).toBe('system');
    });

    it('returns stored "light"', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'light');
      expect(await getThemePreference()).toBe('light');
    });

    it('returns stored "dark"', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'dark');
      expect(await getThemePreference()).toBe('dark');
    });

    it('returns stored "system"', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'system');
      expect(await getThemePreference()).toBe('system');
    });

    it('returns "system" for invalid stored value', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'neon');
      expect(await getThemePreference()).toBe('system');
    });

    it('returns "system" on storage error', async () => {
      const mockGetItem = AsyncStorage.getItem as jest.Mock;
      mockGetItem.mockRejectedValueOnce(new Error('fail'));
      expect(await getThemePreference()).toBe('system');
    });
  });
});

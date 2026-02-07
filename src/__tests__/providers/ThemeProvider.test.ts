/**
 * ThemeProvider Tests
 *
 * Tests getThemePreference by mocking react-native lazily (jest.doMock)
 * to avoid clobbering AsyncStorage in the node environment.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'veloq-theme-preference';

describe('ThemeProvider', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('getThemePreference()', () => {
    let getThemePreference: () => Promise<string>;

    beforeAll(() => {
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

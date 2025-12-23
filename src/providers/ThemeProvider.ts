import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'veloq-theme-preference';

/**
 * Initialize theme on app start.
 * Call this early in _layout.tsx before rendering.
 */
export async function initializeTheme(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      Appearance.setColorScheme(saved);
    } else {
      Appearance.setColorScheme(null); // Follow system
    }
  } catch (error) {
    // Fall back to system theme if storage fails
    Appearance.setColorScheme(null);
  }
}

/**
 * Change and persist theme preference.
 * Updates immediately via Appearance.setColorScheme().
 */
export async function setThemePreference(preference: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
  Appearance.setColorScheme(preference === 'system' ? null : preference);
}

/**
 * Get current saved preference.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    return 'system';
  } catch {
    return 'system';
  }
}

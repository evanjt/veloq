import { Appearance, useColorScheme, type ColorSchemeName } from 'react-native';
import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'veloq-theme-preference';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  setHydratedPreference: (preference: ThemePreference) => void;
  setPreference: (preference: ThemePreference) => void;
}

function normalizePreference(value: string | null): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

export const useThemePreferenceStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,
  setHydratedPreference: (preference) => set({ preference, hydrated: true }),
  setPreference: (preference) => set({ preference, hydrated: true }),
}));

function applyThemePreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/**
 * Initialize theme on app start.
 * Call this early in _layout.tsx before rendering.
 */
export async function initializeTheme(): Promise<void> {
  try {
    const preference = normalizePreference(await getSetting(STORAGE_KEY));
    useThemePreferenceStore.getState().setHydratedPreference(preference);
    applyThemePreference(preference);
  } catch {
    // Fall back to system theme if storage fails
    useThemePreferenceStore.getState().setHydratedPreference('system');
    applyThemePreference('system');
  }
}

/**
 * Change and persist theme preference.
 * Updates immediately via Appearance.setColorScheme().
 */
export async function setThemePreference(preference: ThemePreference): Promise<void> {
  useThemePreferenceStore.getState().setPreference(preference);
  applyThemePreference(preference);
  await setSetting(STORAGE_KEY, preference);
}

/**
 * Get current saved preference.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const store = useThemePreferenceStore.getState();
  if (store.hydrated) {
    return store.preference;
  }
  try {
    return normalizePreference(await getSetting(STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function useResolvedColorScheme(): NonNullable<ColorSchemeName> {
  const preference = useThemePreferenceStore((s) => s.preference);
  const systemScheme = useColorScheme();
  if (preference === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return preference;
}

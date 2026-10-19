import {
  AccessibilityInfo,
  Appearance,
  Platform,
  useColorScheme,
  type ColorSchemeName,
} from 'react-native';
import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'veloq-theme-preference';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  setHydratedPreference: (preference: ThemePreference) => void;
  setPreference: (preference: ThemePreference) => void;
}

function normalisePreference(value: string | null): ThemePreference {
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
  // RN 0.85 made Appearance.setColorScheme non-null; 'unspecified' is the
  // reset-to-system value (passing null crashes the native AppearanceModule).
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/**
 * Initialise theme on app start.
 * Call this early in _layout.tsx before rendering.
 */
export async function initialiseTheme(): Promise<void> {
  watchOpaqueChrome();
  try {
    const preference = normalisePreference(await getSetting(STORAGE_KEY));
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

export function useResolvedColorScheme(): NonNullable<ColorSchemeName> {
  const preference = useThemePreferenceStore((s) => s.preference);
  const systemScheme = useColorScheme();
  if (preference === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return preference;
}

/**
 * The system settings that ask for chrome to stop borrowing contrast from what
 * is drawn beneath it: Reduce Transparency and Increase Contrast on iOS,
 * high-contrast text on Android. Each is read on the one platform that has it.
 */
type ChromeSettingEvent =
  'reduceTransparencyChanged' | 'darkerSystemColorsChanged' | 'highTextContrastChanged';

interface ChromeSetting {
  read: () => Promise<boolean>;
  event: ChromeSettingEvent;
}

function chromeSettings(): ChromeSetting[] {
  if (Platform.OS === 'ios') {
    return [
      {
        read: () => AccessibilityInfo.isReduceTransparencyEnabled(),
        event: 'reduceTransparencyChanged',
      },
      {
        read: () => AccessibilityInfo.isDarkerSystemColorsEnabled(),
        event: 'darkerSystemColorsChanged',
      },
    ];
  }
  if (Platform.OS === 'android') {
    return [
      {
        read: () => AccessibilityInfo.isHighTextContrastEnabled(),
        event: 'highTextContrastChanged',
      },
    ];
  }
  return [];
}

interface OpaqueChromeState {
  /** True while any of the platform's contrast settings is on. */
  preferOpaqueChrome: boolean;
}

export const useOpaqueChromeStore = create<OpaqueChromeState>(() => ({
  preferOpaqueChrome: false,
}));

let stopWatching: (() => void) | null = null;

/**
 * Read the platform's contrast settings once and follow their changes into
 * `preferOpaqueChrome`. Starting it again while it runs does nothing; the
 * returned function stops it and turns the flag off.
 */
export function watchOpaqueChrome(): () => void {
  if (stopWatching) return stopWatching;

  const enabled = new Map<ChromeSettingEvent, boolean>();
  const publish = () =>
    useOpaqueChromeStore.setState({
      preferOpaqueChrome: [...enabled.values()].some(Boolean),
    });

  let live = true;
  const subscriptions = chromeSettings().map(({ read, event }) => {
    read()
      .then((on) => {
        // A change heard before the first read answered is the newer value.
        if (!live || enabled.has(event)) return;
        enabled.set(event, on);
        publish();
      })
      .catch(() => {
        // A platform that cannot answer leaves the chrome as drawn.
      });
    return AccessibilityInfo.addEventListener(event, (on: boolean) => {
      enabled.set(event, on);
      publish();
    });
  });

  stopWatching = () => {
    live = false;
    subscriptions.forEach((subscription) => subscription.remove());
    useOpaqueChromeStore.setState({ preferOpaqueChrome: false });
    stopWatching = null;
  };
  return stopWatching;
}

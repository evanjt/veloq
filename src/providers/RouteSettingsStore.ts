/**
 * Route matching settings store.
 * Controls whether route matching is enabled and other route-related preferences.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/lib/debug';

const log = debug.create('RouteSettings');

const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

interface RouteSettings {
  /** Whether route matching feature is enabled */
  enabled: boolean;
}

const DEFAULT_SETTINGS: RouteSettings = {
  enabled: true, // Enabled by default - efficient Rust implementation
};

interface RouteSettingsState {
  settings: RouteSettings;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useRouteSettings = create<RouteSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<RouteSettings>;
        set({
          settings: { ...DEFAULT_SETTINGS, ...parsed },
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setEnabled: async (enabled: boolean) => {
    const newSettings = { ...get().settings, enabled };
    try {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings));
      set({ settings: newSettings });
    } catch (error) {
      log.error('Failed to save settings:', error);
    }
  },
}));

// Helper for synchronous access
export function isRouteMatchingEnabled(): boolean {
  return useRouteSettings.getState().settings.enabled;
}

// Initialize route settings (call during app startup)
export async function initializeRouteSettings(): Promise<void> {
  await useRouteSettings.getState().initialize();
}

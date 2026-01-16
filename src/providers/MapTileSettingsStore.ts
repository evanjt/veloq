/**
 * Map tile caching settings store.
 * Controls whether offline map tile caching is enabled.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug, safeJsonParseWithSchema } from '@/lib';

const log = debug.create('MapTileSettings');

const MAP_TILE_SETTINGS_KEY = 'veloq-map-tile-settings';

/** Maximum tile cache size in megabytes */
export const MAX_TILE_CACHE_SIZE_MB = 500;

interface MapTileSettings {
  /** Whether automatic tile caching is enabled */
  enabled: boolean;
}

const DEFAULT_SETTINGS: MapTileSettings = {
  enabled: true, // Enabled by default for offline support
};

/**
 * Type guard for MapTileSettings
 */
function isMapTileSettings(value: unknown): value is MapTileSettings {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  return true;
}

interface MapTileSettingsState {
  settings: MapTileSettings;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useMapTileSettings = create<MapTileSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(MAP_TILE_SETTINGS_KEY);
      if (stored) {
        const parsed = safeJsonParseWithSchema(stored, isMapTileSettings, DEFAULT_SETTINGS);
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
      await AsyncStorage.setItem(MAP_TILE_SETTINGS_KEY, JSON.stringify(newSettings));
      set({ settings: newSettings });
      log.log(`Tile caching ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      log.error('Failed to save tile settings:', error);
    }
  },
}));

/** Check if tile caching is enabled (synchronous) */
export function isTileCachingEnabled(): boolean {
  return useMapTileSettings.getState().settings.enabled;
}

/** Initialize map tile settings (call during app startup) */
export async function initializeMapTileSettings(): Promise<void> {
  await useMapTileSettings.getState().initialize();
}

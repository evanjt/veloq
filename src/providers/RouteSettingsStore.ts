/**
 * Route matching settings store.
 * Controls whether route matching is enabled and other route-related preferences.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug, safeJsonParseWithSchema } from '@/lib';

const log = debug.create('RouteSettings');

const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

interface RouteSettings {
  /** Whether route matching feature is enabled */
  enabled: boolean;
  /** Number of days to retain activities before cleanup (default: 0 = keep all) */
  retentionDays: number;
  /** Whether automatic cleanup is enabled (default: false) */
  autoCleanupEnabled: boolean;
}

const DEFAULT_SETTINGS: RouteSettings = {
  enabled: true, // Enabled by default - efficient Rust implementation
  retentionDays: 0, // 0 = keep all activities forever
  autoCleanupEnabled: false, // Don't auto-delete by default
};

/**
 * Type guard for RouteSettings
 */
function isRouteSettings(value: unknown): value is RouteSettings {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  // enabled is optional in partial, so just check it's boolean if present
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  // retentionDays must be a number if present (0 means keep all)
  if ('retentionDays' in obj && typeof obj.retentionDays !== 'number') return false;
  // autoCleanupEnabled must be boolean if present
  if ('autoCleanupEnabled' in obj && typeof obj.autoCleanupEnabled !== 'boolean') return false;
  return true;
}

interface RouteSettingsState {
  settings: RouteSettings;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setRetentionDays: (days: number) => Promise<void>;
  setAutoCleanupEnabled: (enabled: boolean) => Promise<void>;
}

export const useRouteSettings = create<RouteSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(ROUTE_SETTINGS_KEY);
      if (stored) {
        const parsed = safeJsonParseWithSchema(stored, isRouteSettings, DEFAULT_SETTINGS);
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

  setRetentionDays: async (days: number) => {
    // Validate retention days (0 = keep all, 30-365 for cleanup)
    const validatedDays = days === 0 ? 0 : Math.max(30, Math.min(365, days));
    const newSettings = { ...get().settings, retentionDays: validatedDays };
    try {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings));
      set({ settings: newSettings });
      log.log(
        `Retention period set to ${validatedDays === 0 ? 'keep all' : `${validatedDays} days`}`
      );
    } catch (error) {
      log.error('Failed to save retention days:', error);
    }
  },

  setAutoCleanupEnabled: async (enabled: boolean) => {
    const newSettings = { ...get().settings, autoCleanupEnabled: enabled };
    try {
      await AsyncStorage.setItem(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings));
      set({ settings: newSettings });
      log.log(`Auto cleanup ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      log.error('Failed to save auto cleanup setting:', error);
    }
  },
}));

// Helper for synchronous access
export function isRouteMatchingEnabled(): boolean {
  return useRouteSettings.getState().settings.enabled;
}

// Helper for getting retention days synchronously
export function getRetentionDays(): number {
  return useRouteSettings.getState().settings.retentionDays;
}

// Initialize route settings (call during app startup)
export async function initializeRouteSettings(): Promise<void> {
  await useRouteSettings.getState().initialize();
}

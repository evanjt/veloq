/**
 * Route matching settings store.
 * Controls whether route matching is enabled and other route-related preferences.
 */

import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';
import { safeJsonParseWithSchema } from '@/shared/validation/validation';

const log = debug.create('RouteSettings');

const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

interface RouteSettings {
  /** Whether route matching feature is enabled */
  enabled: boolean;
  /** Number of days to retain activities before cleanup (default: 0 = keep all) */
  retentionDays: number;
  /** Whether automatic cleanup is enabled (default: false) */
  autoCleanupEnabled: boolean;
  /** Whether heatmap tile generation is enabled (default: true) */
  heatmapEnabled: boolean;
}

const DEFAULT_SETTINGS: RouteSettings = {
  enabled: true, // Enabled by default - efficient Rust implementation
  retentionDays: 0, // 0 = keep all activities forever
  autoCleanupEnabled: false, // Don't auto-delete by default
  heatmapEnabled: true, // Generate heatmap tiles by default
};

/**
 * Type guard for RouteSettings
 */
function isRouteSettings(value: unknown): value is RouteSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  // enabled is optional in partial, so just check it's boolean if present
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  // retentionDays must be a number if present (0 means keep all)
  if ('retentionDays' in obj && typeof obj.retentionDays !== 'number') return false;
  // autoCleanupEnabled must be boolean if present
  if ('autoCleanupEnabled' in obj && typeof obj.autoCleanupEnabled !== 'boolean') return false;
  // heatmapEnabled must be boolean if present
  if ('heatmapEnabled' in obj && typeof obj.heatmapEnabled !== 'boolean') return false;
  return true;
}

// A retired field left behind in storage must not ride back into state, or
// every later write persists it again.
function pickSettings(parsed: Partial<RouteSettings>): RouteSettings {
  return {
    enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
    retentionDays: parsed.retentionDays ?? DEFAULT_SETTINGS.retentionDays,
    autoCleanupEnabled: parsed.autoCleanupEnabled ?? DEFAULT_SETTINGS.autoCleanupEnabled,
    heatmapEnabled: parsed.heatmapEnabled ?? DEFAULT_SETTINGS.heatmapEnabled,
  };
}

interface RouteSettingsState {
  settings: RouteSettings;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setRetentionDays: (days: number) => Promise<void>;
  setAutoCleanupEnabled: (enabled: boolean) => Promise<void>;
  setHeatmapEnabled: (enabled: boolean) => Promise<void>;
}

export const useRouteSettings = create<RouteSettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(ROUTE_SETTINGS_KEY);
      if (stored) {
        const parsed = safeJsonParseWithSchema(stored, isRouteSettings, DEFAULT_SETTINGS);
        set({
          settings: pickSettings(parsed),
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
    set((state) => {
      const newSettings = { ...state.settings, enabled };
      setSetting(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings)).catch((error) => {
        log.error('Failed to save settings:', error);
      });
      return { settings: newSettings };
    });

    try {
      const { getRouteEngine } = require('@/shared/native/routeEngine');
      const engine = getRouteEngine();
      if (engine) {
        if (!enabled) {
          // Clear route/section data from SQLite (GPS tracks preserved for heatmap)
          engine.clearRoutesAndSections();
        }
        // Notify UI to update sections/routes visibility
        engine.triggerRefresh('sections');
        engine.triggerRefresh('groups');
        if (enabled) {
          // Trigger activity refresh so sync picks up and runs detection
          engine.triggerRefresh('activities');
        }
      }
    } catch {
      // Engine might not be available yet
    }
  },

  setRetentionDays: async (days: number) => {
    // Validate retention days (0 = keep all, 30-365 for cleanup)
    const validatedDays = days === 0 ? 0 : Math.max(30, Math.min(365, days));

    // Use functional update to ensure we read the latest state (fixes race condition)
    set((state) => {
      const newSettings = { ...state.settings, retentionDays: validatedDays };
      // Persist asynchronously - errors logged but don't block state update
      setSetting(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings)).catch((error) => {
        log.error('Failed to save retention days:', error);
      });
      return { settings: newSettings };
    });

    log.log(
      `Retention period set to ${validatedDays === 0 ? 'keep all' : `${validatedDays} days`}`
    );
  },

  setAutoCleanupEnabled: async (enabled: boolean) => {
    // Use functional update to ensure we read the latest state (fixes race condition)
    set((state) => {
      const newSettings = { ...state.settings, autoCleanupEnabled: enabled };
      // Persist asynchronously - errors logged but don't block state update
      setSetting(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings)).catch((error) => {
        log.error('Failed to save auto cleanup setting:', error);
      });
      return { settings: newSettings };
    });

    log.log(`Auto cleanup ${enabled ? 'enabled' : 'disabled'}`);
  },

  setHeatmapEnabled: async (enabled: boolean) => {
    set((state) => {
      const newSettings = { ...state.settings, heatmapEnabled: enabled };
      setSetting(ROUTE_SETTINGS_KEY, JSON.stringify(newSettings)).catch((error) => {
        log.error('Failed to save heatmap setting:', error);
      });
      return { settings: newSettings };
    });

    log.log(`Heatmap generation ${enabled ? 'enabled' : 'disabled'}`);
  },
}));

// Helper for synchronous access
export function isRouteMatchingEnabled(): boolean {
  return useRouteSettings.getState().settings.enabled;
}

// Helper for checking heatmap enabled synchronously
export function isHeatmapEnabled(): boolean {
  return useRouteSettings.getState().settings.heatmapEnabled;
}

// Initialize route settings (call during app startup)
export async function initializeRouteSettings(): Promise<void> {
  await useRouteSettings.getState().initialize();
}

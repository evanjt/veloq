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

/**
 * The engine's own copy of the switch. Rust owns what the engine does, so the
 * refusal lives there and this store writes through to it; the key is Rust's
 * (`settings_keys::DETECTION_ENABLED`) and absent means on.
 */
const DETECTION_ENABLED_KEY = '__detection_enabled';

interface RouteSettings {
  /** Whether route matching feature is enabled */
  enabled: boolean;
  /** Number of days to retain activities before cleanup (default: 0 = keep all) */
  /** Whether automatic cleanup is enabled (default: false) */
  autoCleanupEnabled: boolean;
  /** Whether heatmap tile generation is enabled (default: true) */
}

const DEFAULT_SETTINGS: RouteSettings = {
  enabled: true, // Enabled by default - efficient Rust implementation
  autoCleanupEnabled: false, // Don't auto-delete by default
};

/**
 * Type guard for RouteSettings
 */
function isRouteSettings(value: unknown): value is RouteSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  // enabled is optional in partial, so just check it's boolean if present
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  // autoCleanupEnabled must be boolean if present
  if ('autoCleanupEnabled' in obj && typeof obj.autoCleanupEnabled !== 'boolean') return false;
  return true;
}

// A retired field left behind in storage must not ride back into state, or
// every later write persists it again.
function pickSettings(parsed: Partial<RouteSettings>): RouteSettings {
  return {
    enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
    autoCleanupEnabled: parsed.autoCleanupEnabled ?? DEFAULT_SETTINGS.autoCleanupEnabled,
  };
}

interface RouteSettingsState {
  settings: RouteSettings;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setAutoCleanupEnabled: (enabled: boolean) => Promise<void>;
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
      const { getEngine } = require('@/shared/native/engine');
      const engine = getEngine();
      if (engine) {
        // The engine starts a conditioning detect at the end of every stored
        // batch and used to know nothing about this switch, so with it off it
        // kept cutting the catalogue while the screens looked away.
        // Written before the refresh below, so nothing can start a detect in
        // the window between the two.
        engine.setSetting?.(DETECTION_ENABLED_KEY, enabled ? '1' : '0');
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
}));

// Helper for synchronous access
export function isRouteMatchingEnabled(): boolean {
  return useRouteSettings.getState().settings.enabled;
}

// Initialize route settings (call during app startup)
export async function initializeRouteSettings(): Promise<void> {
  await useRouteSettings.getState().initialize();
}

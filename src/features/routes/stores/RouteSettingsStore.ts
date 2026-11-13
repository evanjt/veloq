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
}

const DEFAULT_SETTINGS: RouteSettings = {
  enabled: true, // Enabled by default - efficient Rust implementation
};

/**
 * Type guard for RouteSettings
 */
function isRouteSettings(value: unknown): value is RouteSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  // enabled is optional in partial, so just check it's boolean if present
  if ('enabled' in obj && typeof obj.enabled !== 'boolean') return false;
  return true;
}

// A retired field left behind in storage must not ride back into state, or
// every later write persists it again.
function pickSettings(parsed: Partial<RouteSettings>): RouteSettings {
  return {
    enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
  };
}

interface RouteSettingsState {
  settings: RouteSettings;
  isLoaded: boolean;

  // Actions
  initialise: () => Promise<void>;
  /** Read the stored settings again, after something else wrote them. */
  reload: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useRouteSettings = create<RouteSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  initialise: async () => {
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
      const { getEngine } = require('@/shared/native/engine');
      const engine = getEngine();
      const detectionEnabled = get().settings.enabled ? '1' : '0';
      if (engine && engine.getSetting(DETECTION_ENABLED_KEY) !== detectionEnabled) {
        // The delegate holds this write until the engine opens on a cold start.
        engine.setSetting(DETECTION_ENABLED_KEY, detectionEnabled);
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  reload: async () => {
    try {
      const stored = await getSetting(ROUTE_SETTINGS_KEY);
      const parsed = stored
        ? safeJsonParseWithSchema(stored, isRouteSettings, DEFAULT_SETTINGS)
        : DEFAULT_SETTINGS;
      const settings = pickSettings(parsed);
      // The engine owns the switch, and a linked browser writes it there
      // alone, so the engine's value wins over the stored copy.
      const { getEngine } = require('@/shared/native/engine');
      const held = getEngine()?.getSetting?.(DETECTION_ENABLED_KEY);
      if (held === '0' || held === '1') settings.enabled = held === '1';
      set({ settings, isLoaded: true });
    } catch (error) {
      log.error('Failed to reload settings:', error);
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
}));

// Helper for synchronous access
export function isRouteMatchingEnabled(): boolean {
  return useRouteSettings.getState().settings.enabled;
}

// Initialise route settings (call during app startup)
export async function initialiseRouteSettings(): Promise<void> {
  await useRouteSettings.getState().initialise();
}

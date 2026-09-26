/**
 * Route matching settings store.
 * Controls whether route matching is enabled and other route-related preferences.
 */

import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { debug } from '@/shared/debug/debug';
import { safeJsonParseWithSchema } from '@/shared/validation/validation';
import { runCatalogueClear } from '@/shared/native/engineClears';
import { engineErrorKey, type EngineFailureKey } from '@/shared/native/engineError';

const log = debug.create('RouteSettings');

const ROUTE_SETTINGS_KEY = 'veloq-route-settings';

/**
 * The engine's own copy of the switch. Rust owns what the engine does, so the
 * refusal lives there and this store writes through to it; the key is Rust's
 * (`settings_keys::DETECTION_ENABLED`) and absent means on.
 */
const DETECTION_ENABLED_KEY = '__detection_enabled';

/** What the switch can say about the wipe it started. */
export type ClearNoticeKey = EngineFailureKey | 'settings.stillRunning' | 'alerts.failedToClear';

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
  /**
   * What the switch has to say about the catalogue wipe, as an i18n key, or
   * null when there is nothing to say.
   *
   * One field and not a boolean because the wipe has three endings the athlete
   * would act on differently: it landed, it is still running past the wait, or
   * the engine refused and named which failure it was.
   */
  clearNotice: ClearNoticeKey | null;

  // Actions
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setAutoCleanupEnabled: (enabled: boolean) => Promise<void>;
}

export const useRouteSettings = create<RouteSettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  clearNotice: null,

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
    set({ clearNotice: null });
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
          // Clear route/section data from SQLite (GPS tracks preserved for
          // heatmap). The wipe runs on a Rust thread because on a full library
          // it takes long enough to drop frames, and the refresh below waits
          // for it so the screens never read a catalogue still draining. A
          // wipe that fails is logged and the refresh still runs: a stuck
          // switch is worse than a stale list.
          // The refresh runs whatever the wipe did: a stuck switch is worse
          // than a stale list. What changed is that the failure is named. The
          // engine refusing and this side giving up on the wait were one catch
          // with one outcome, and the athlete was told neither.
          const notice: ClearNoticeKey | null = await runCatalogueClear(engine).then(
            (outcome) =>
              outcome.state === 'stillRunning' ? ('settings.stillRunning' as const) : null,
            (error) => {
              log.error('Failed to clear routes and sections:', error);
              return engineErrorKey(error, 'alerts.failedToClear');
            }
          );
          set({ clearNotice: notice });
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

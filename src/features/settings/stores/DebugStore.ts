import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';

const DEBUG_MODE_KEY = 'veloq-debug-mode';

interface DebugState {
  /** Whether the debug toggle has been revealed via 5-tap gesture */
  unlocked: boolean;
  /** Whether debug overlays are currently shown */
  enabled: boolean;
  isLoaded: boolean;

  initialize: () => Promise<void>;
  unlock: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useDebugStore = create<DebugState>((set) => ({
  unlocked: false,
  enabled: false,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(DEBUG_MODE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const enabled = parsed.enabled === true;
        set({
          unlocked: enabled,
          enabled,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  unlock: async () => {
    set({ unlocked: true });
  },

  setEnabled: async (enabled: boolean) => {
    await setSetting(DEBUG_MODE_KEY, JSON.stringify({ enabled }));
    set({ enabled, unlocked: enabled });
  },
}));

/** Initialize debug store and wire up FFI metric recording */
export async function initializeDebugStore(): Promise<void> {
  await useDebugStore.getState().initialize();
  syncDebugToFFI();
}

let unsubscribeFromStore: (() => void) | null = null;

/** Sync debug enabled state to EngineClient for FFI metric recording */
function syncDebugToFFI(): void {
  const { setAppMetricsEnabled, recordFFIMetric } = require('@/shared/debug/renderTimer');
  setAppMetricsEnabled(useDebugStore.getState().enabled);
  // Initialisation runs at launch and after every restore; hold one listener.
  unsubscribeFromStore?.();
  unsubscribeFromStore = null;
  let engine: { setMetricRecorder: (r: unknown) => void; setDebugEnabled: (e: boolean) => void };
  try {
    engine = require('veloqrs').EngineClient;
    engine.setMetricRecorder(recordFFIMetric);
    engine.setDebugEnabled(useDebugStore.getState().enabled);
  } catch {
    // Native module not available (web/Expo Go)
    engine = { setMetricRecorder: () => {}, setDebugEnabled: () => {} };
  }
  unsubscribeFromStore = useDebugStore.subscribe((state) => {
    setAppMetricsEnabled(state.enabled);
    engine.setDebugEnabled(state.enabled);
  });
}

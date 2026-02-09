import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      const stored = await AsyncStorage.getItem(DEBUG_MODE_KEY);
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
    await AsyncStorage.setItem(DEBUG_MODE_KEY, JSON.stringify({ enabled }));
    set({ enabled, unlocked: enabled });
  },
}));

/** Synchronous getter for non-React contexts */
export function isDebugEnabled(): boolean {
  return useDebugStore.getState().enabled;
}

/** Initialize debug store and wire up FFI metric recording */
export async function initializeDebugStore(): Promise<void> {
  await useDebugStore.getState().initialize();
  syncDebugToFFI();
}

/** Sync debug enabled state to RouteEngineClient for FFI metric recording */
function syncDebugToFFI(): void {
  try {
    const { RouteEngineClient } = require('veloqrs');
    const { recordFFIMetric } = require('@/lib/debug/renderTimer');
    RouteEngineClient.setMetricRecorder(recordFFIMetric);
    RouteEngineClient.setDebugEnabled(useDebugStore.getState().enabled);
    useDebugStore.subscribe((state) => {
      RouteEngineClient.setDebugEnabled(state.enabled);
    });
  } catch {
    // Native module not available (web/Expo Go)
  }
}

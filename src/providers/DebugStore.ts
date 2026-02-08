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

export const useDebugStore = create<DebugState>((set, get) => ({
  unlocked: false,
  enabled: false,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(DEBUG_MODE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        set({
          unlocked: parsed.unlocked === true,
          enabled: parsed.enabled === true,
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
    const state = get();
    const next = { unlocked: true, enabled: state.enabled };
    await AsyncStorage.setItem(DEBUG_MODE_KEY, JSON.stringify(next));
    set({ unlocked: true });
  },

  setEnabled: async (enabled: boolean) => {
    const next = { unlocked: true, enabled };
    await AsyncStorage.setItem(DEBUG_MODE_KEY, JSON.stringify(next));
    set({ enabled });
  },
}));

/** Synchronous getter for non-React contexts */
export function isDebugEnabled(): boolean {
  return useDebugStore.getState().enabled;
}

/** Initialize debug store (call during app startup) */
export async function initializeDebugStore(): Promise<void> {
  await useDebugStore.getState().initialize();
}

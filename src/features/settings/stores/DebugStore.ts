import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import type { ExperimentalFeatureKey } from '../lib/experimentalFeatures';

const DEBUG_MODE_KEY = 'veloq-debug-mode';
const EXPERIMENTAL_KEY = 'veloq-experimental';

type ExperimentalChoices = Partial<Record<ExperimentalFeatureKey, boolean>>;

interface DebugState {
  /** Whether the debug toggle has been revealed via 5-tap gesture */
  unlocked: boolean;
  /** Whether debug overlays are currently shown */
  enabled: boolean;
  isLoaded: boolean;

  /** Whether the experimental switch has been revealed via the same gesture */
  experimentalUnlocked: boolean;
  /** The experimental master switch: no experimental surface shows while it is off */
  experimentalEnabled: boolean;
  /** Per-feature choices. A feature never switched is on under the master. */
  experimentalFeatures: ExperimentalChoices;

  initialise: () => Promise<void>;
  unlock: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  unlockExperimental: () => void;
  setExperimentalEnabled: (enabled: boolean) => Promise<void>;
  setExperimentalFeature: (key: ExperimentalFeatureKey, on: boolean) => Promise<void>;
}

async function persistExperimental(enabled: boolean, features: ExperimentalChoices) {
  await setSetting(EXPERIMENTAL_KEY, JSON.stringify({ enabled, features }));
}

async function readExperimental(): Promise<{ enabled: boolean; features: ExperimentalChoices }> {
  try {
    const stored = await getSetting(EXPERIMENTAL_KEY);
    if (!stored) return { enabled: false, features: {} };
    const parsed = JSON.parse(stored);
    const features: ExperimentalChoices = {};
    for (const [key, value] of Object.entries(parsed.features ?? {})) {
      if (typeof value === 'boolean') features[key as ExperimentalFeatureKey] = value;
    }
    return { enabled: parsed.enabled === true, features };
  } catch {
    return { enabled: false, features: {} };
  }
}

export const useDebugStore = create<DebugState>((set, get) => ({
  unlocked: false,
  enabled: false,
  isLoaded: false,
  experimentalUnlocked: false,
  experimentalEnabled: false,
  experimentalFeatures: {},

  initialise: async () => {
    try {
      const stored = await getSetting(DEBUG_MODE_KEY);
      const experimental = await readExperimental();
      set({
        experimentalUnlocked: experimental.enabled,
        experimentalEnabled: experimental.enabled,
        experimentalFeatures: experimental.features,
      });
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

  unlockExperimental: () => set({ experimentalUnlocked: true }),

  setExperimentalEnabled: async (enabled: boolean) => {
    await persistExperimental(enabled, get().experimentalFeatures);
    set({ experimentalEnabled: enabled, experimentalUnlocked: enabled });
  },

  setExperimentalFeature: async (key, on) => {
    const features = { ...get().experimentalFeatures, [key]: on };
    await persistExperimental(get().experimentalEnabled, features);
    set({ experimentalFeatures: features });
  },
}));

/** Initialise debug store and wire up FFI metric recording */
export async function initialiseDebugStore(): Promise<void> {
  await useDebugStore.getState().initialise();
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

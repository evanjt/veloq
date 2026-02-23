import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityType, DataFieldType } from '@/types';

const STORAGE_KEY = 'veloq-recording-preferences';

const DEFAULT_AUTO_PAUSE_THRESHOLDS: Record<string, number> = {
  cycling: 2,
  running: 1,
  walking: 0.5,
};

const DEFAULT_DATA_FIELDS: Record<string, DataFieldType[]> = {
  gps: ['speed', 'distance', 'heartrate', 'power'],
  indoor: ['heartrate', 'power', 'cadence', 'timer'],
  manual: ['timer', 'distance'],
};

interface RecordingPreferencesState {
  recentActivityTypes: ActivityType[];
  autoPauseEnabled: boolean;
  autoPauseThresholds: Record<string, number>;
  dataFields: Record<string, DataFieldType[]>;
  isLoaded: boolean;
  // Actions
  initialize: () => Promise<void>;
  addRecentType: (type: ActivityType) => void;
  setAutoPause: (enabled: boolean) => void;
  setAutoPauseThreshold: (sport: string, kmh: number) => void;
  setDataFields: (mode: string, fields: DataFieldType[]) => void;
}

export const useRecordingPreferences = create<RecordingPreferencesState>((set, get) => ({
  recentActivityTypes: [],
  autoPauseEnabled: true,
  autoPauseThresholds: { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
  dataFields: { ...DEFAULT_DATA_FIELDS },
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<RecordingPreferencesState>;
        set({
          recentActivityTypes: parsed.recentActivityTypes ?? [],
          autoPauseEnabled: parsed.autoPauseEnabled ?? true,
          autoPauseThresholds: parsed.autoPauseThresholds ?? { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
          dataFields: parsed.dataFields ?? { ...DEFAULT_DATA_FIELDS },
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      if (__DEV__) {
        console.warn('[RecordingPreferences] Failed to initialize');
      }
      set({ isLoaded: true });
    }
  },

  addRecentType: (type) => {
    set((state) => {
      const filtered = state.recentActivityTypes.filter((t) => t !== type);
      const updated = [type, ...filtered].slice(0, 4);
      persistPreferences({ ...state, recentActivityTypes: updated });
      return { recentActivityTypes: updated };
    });
  },

  setAutoPause: (enabled) => {
    set((state) => {
      persistPreferences({ ...state, autoPauseEnabled: enabled });
      return { autoPauseEnabled: enabled };
    });
  },

  setAutoPauseThreshold: (sport, kmh) => {
    set((state) => {
      const updated = { ...state.autoPauseThresholds, [sport]: kmh };
      persistPreferences({ ...state, autoPauseThresholds: updated });
      return { autoPauseThresholds: updated };
    });
  },

  setDataFields: (mode, fields) => {
    set((state) => {
      const updated = { ...state.dataFields, [mode]: fields };
      persistPreferences({ ...state, dataFields: updated });
      return { dataFields: updated };
    });
  },
}));

async function persistPreferences(state: Partial<RecordingPreferencesState>): Promise<void> {
  try {
    const data = {
      recentActivityTypes: state.recentActivityTypes,
      autoPauseEnabled: state.autoPauseEnabled,
      autoPauseThresholds: state.autoPauseThresholds,
      dataFields: state.dataFields,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    if (__DEV__) {
      console.warn('[RecordingPreferences] Failed to persist');
    }
  }
}

export async function initializeRecordingPreferences(): Promise<void> {
  await useRecordingPreferences.getState().initialize();
}

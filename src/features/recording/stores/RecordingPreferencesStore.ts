import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
import type { ActivityType, DataFieldType } from '@/types';

const STORAGE_KEY = 'veloq-recording-preferences';

/** GPS sampling presets: accuracy vs battery. Interval/distance mapping lives in lib/gpsConfig.ts. */
export type GpsAccuracyMode = 'high' | 'balanced' | 'batterySaver';

const DEFAULT_ACCURACY_REJECT_THRESHOLD_M = 30;
const DEFAULT_AUTO_PAUSE_DURATION_MS = 3000;

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
  /** Upload recordings to intervals.icu automatically on save. Off = save locally, upload manually from the library. */
  autoUploadEnabled: boolean;
  gpsAccuracyMode: GpsAccuracyMode;
  /** GPS points less accurate than this (metres) are discarded. */
  accuracyRejectThreshold: number;
  /** Time below the speed threshold before auto-pause triggers. */
  autoPauseDurationMs: number;
  keepAwakeEnabled: boolean;
  isLoaded: boolean;
  // Actions
  initialize: () => Promise<void>;
  addRecentType: (type: ActivityType) => void;
  setAutoPause: (enabled: boolean) => void;
  setAutoPauseThreshold: (sport: string, kmh: number) => void;
  setDataFields: (mode: string, fields: DataFieldType[]) => void;
  setAutoUpload: (enabled: boolean) => void;
  setGpsAccuracyMode: (mode: GpsAccuracyMode) => void;
  setAccuracyRejectThreshold: (metres: number) => void;
  setAutoPauseDuration: (ms: number) => void;
  setKeepAwake: (enabled: boolean) => void;
}

export const useRecordingPreferences = create<RecordingPreferencesState>((set, get) => ({
  recentActivityTypes: [],
  autoPauseEnabled: true,
  autoPauseThresholds: { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
  dataFields: { ...DEFAULT_DATA_FIELDS },
  autoUploadEnabled: true,
  gpsAccuracyMode: 'high',
  accuracyRejectThreshold: DEFAULT_ACCURACY_REJECT_THRESHOLD_M,
  autoPauseDurationMs: DEFAULT_AUTO_PAUSE_DURATION_MS,
  keepAwakeEnabled: true,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<RecordingPreferencesState>;
        set({
          recentActivityTypes: Array.isArray(parsed.recentActivityTypes)
            ? parsed.recentActivityTypes
            : [],
          autoPauseEnabled:
            typeof parsed.autoPauseEnabled === 'boolean' ? parsed.autoPauseEnabled : true,
          autoPauseThresholds:
            parsed.autoPauseThresholds &&
            typeof parsed.autoPauseThresholds === 'object' &&
            !Array.isArray(parsed.autoPauseThresholds)
              ? parsed.autoPauseThresholds
              : { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
          dataFields:
            parsed.dataFields &&
            typeof parsed.dataFields === 'object' &&
            !Array.isArray(parsed.dataFields)
              ? parsed.dataFields
              : { ...DEFAULT_DATA_FIELDS },
          autoUploadEnabled:
            typeof parsed.autoUploadEnabled === 'boolean' ? parsed.autoUploadEnabled : true,
          gpsAccuracyMode:
            parsed.gpsAccuracyMode === 'balanced' || parsed.gpsAccuracyMode === 'batterySaver'
              ? parsed.gpsAccuracyMode
              : 'high',
          accuracyRejectThreshold:
            typeof parsed.accuracyRejectThreshold === 'number' &&
            Number.isFinite(parsed.accuracyRejectThreshold)
              ? parsed.accuracyRejectThreshold
              : DEFAULT_ACCURACY_REJECT_THRESHOLD_M,
          autoPauseDurationMs:
            typeof parsed.autoPauseDurationMs === 'number' &&
            Number.isFinite(parsed.autoPauseDurationMs)
              ? parsed.autoPauseDurationMs
              : DEFAULT_AUTO_PAUSE_DURATION_MS,
          keepAwakeEnabled:
            typeof parsed.keepAwakeEnabled === 'boolean' ? parsed.keepAwakeEnabled : true,
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
    if (!Number.isFinite(kmh) || kmh < 0) return;
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

  setAutoUpload: (enabled) => {
    set((state) => {
      persistPreferences({ ...state, autoUploadEnabled: enabled });
      return { autoUploadEnabled: enabled };
    });
  },

  setGpsAccuracyMode: (mode) => {
    set((state) => {
      persistPreferences({ ...state, gpsAccuracyMode: mode });
      return { gpsAccuracyMode: mode };
    });
  },

  setAccuracyRejectThreshold: (metres) => {
    if (!Number.isFinite(metres) || metres < 10 || metres > 100) return;
    set((state) => {
      persistPreferences({ ...state, accuracyRejectThreshold: metres });
      return { accuracyRejectThreshold: metres };
    });
  },

  setAutoPauseDuration: (ms) => {
    if (!Number.isFinite(ms) || ms < 1000 || ms > 10_000) return;
    set((state) => {
      persistPreferences({ ...state, autoPauseDurationMs: ms });
      return { autoPauseDurationMs: ms };
    });
  },

  setKeepAwake: (enabled) => {
    set((state) => {
      persistPreferences({ ...state, keepAwakeEnabled: enabled });
      return { keepAwakeEnabled: enabled };
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
      autoUploadEnabled: state.autoUploadEnabled,
      gpsAccuracyMode: state.gpsAccuracyMode,
      accuracyRejectThreshold: state.accuracyRejectThreshold,
      autoPauseDurationMs: state.autoPauseDurationMs,
      keepAwakeEnabled: state.keepAwakeEnabled,
    };
    await setSetting(STORAGE_KEY, JSON.stringify(data));
  } catch {
    if (__DEV__) {
      console.warn('[RecordingPreferences] Failed to persist');
    }
  }
}

export async function initializeRecordingPreferences(): Promise<void> {
  await useRecordingPreferences.getState().initialize();
}

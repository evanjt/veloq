import { create } from 'zustand';

import { setRecentRecordingTypes, setRecordedRecordingTypes } from '@/shared/recording';
import { DEFAULT_AUTO_PAUSE_KMH } from '@/shared/recording/sportCategoryDetector';
import { getSetting, setSetting } from '@/shared/storage';
import type { ActivityType, DataFieldType } from '@/types';

import { DEFAULT_DATA_FIELDS, fieldsForMode, placeFieldInSlot } from '../lib/dataFields';
import { parseRecordingType } from '../lib/recordingModes';

const STORAGE_KEY = 'veloq-recording-preferences';

/** GPS sampling presets: accuracy vs battery. Interval/distance mapping lives in lib/gpsConfig.ts. */
export type GpsAccuracyMode = 'high' | 'balanced' | 'batterySaver';

const DEFAULT_ACCURACY_REJECT_THRESHOLD_M = 30;
const DEFAULT_AUTO_PAUSE_DURATION_MS = 3000;

/** The range the athlete may set each recording threshold to, in its stored unit. */
export const ACCURACY_REJECT_BOUNDS_M = { min: 10, max: 100 } as const;
export const AUTO_PAUSE_DURATION_BOUNDS_MS = { min: 1000, max: 10_000 } as const;
export const AUTO_PAUSE_THRESHOLD_BOUNDS_KMH = { min: 0.5, max: 10 } as const;

const DEFAULT_AUTO_PAUSE_THRESHOLDS: Record<string, number> = DEFAULT_AUTO_PAUSE_KMH;

interface RecordingPreferencesState {
  recentActivityTypes: ActivityType[];
  /** Every distinct sport recorded, most recent first. The recents above are its first four. */
  recordedActivityTypes: ActivityType[];
  /**
   * Whether the Always location dialog has been put to the athlete. iOS shows it
   * once, so this is asked-not-granted: a denial must never lead to a second ask.
   */
  alwaysLocationAsked: boolean;
  /**
   * Whether the record screen has raised the Android notification dialog.
   * Android shows it twice at most, so the screen asks once and the notice it
   * draws offers the second ask by hand.
   */
  notificationsAsked: boolean;
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
  /** One-time Android battery-optimisation nudge was dismissed. */
  batteryOptDismissed: boolean;
  isLoaded: boolean;
  // Actions
  initialise: () => Promise<void>;
  addRecentType: (type: ActivityType) => void;
  setAutoPause: (enabled: boolean) => void;
  setAutoPauseThreshold: (sport: string, kmh: number) => void;
  setDataFields: (mode: string, fields: DataFieldType[]) => void;
  /** Shows `field` in tile `index` of a mode, swapping with the tile that already shows it. */
  setSlotField: (mode: string, index: number, field: DataFieldType) => void;
  setAutoUpload: (enabled: boolean) => void;
  setGpsAccuracyMode: (mode: GpsAccuracyMode) => void;
  setAccuracyRejectThreshold: (metres: number) => void;
  setAutoPauseDuration: (ms: number) => void;
  setKeepAwake: (enabled: boolean) => void;
  dismissBatteryOptNudge: () => void;
  markAlwaysLocationAsked: () => void;
  markNotificationsAsked: () => void;
}

/** The sports in a stored list the recorder knows, in order, so a junk entry is not kept for good. */
function knownSports(stored: unknown): ActivityType[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((t: unknown) => {
    const sport = typeof t === 'string' ? parseRecordingType(t) : null;
    return sport === null ? [] : [sport];
  });
}

export const useRecordingPreferences = create<RecordingPreferencesState>((set) => ({
  recentActivityTypes: [],
  recordedActivityTypes: [],
  alwaysLocationAsked: false,
  notificationsAsked: false,
  autoPauseEnabled: true,
  autoPauseThresholds: { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
  dataFields: { ...DEFAULT_DATA_FIELDS },
  autoUploadEnabled: true,
  gpsAccuracyMode: 'high',
  accuracyRejectThreshold: DEFAULT_ACCURACY_REJECT_THRESHOLD_M,
  autoPauseDurationMs: DEFAULT_AUTO_PAUSE_DURATION_MS,
  keepAwakeEnabled: true,
  batteryOptDismissed: false,
  isLoaded: false,

  initialise: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<RecordingPreferencesState>;
        const recentActivityTypes = knownSports(parsed.recentActivityTypes);
        const storedRecorded = knownSports(parsed.recordedActivityTypes);
        const recordedActivityTypes = [
          ...storedRecorded,
          ...recentActivityTypes.filter((t) => !storedRecorded.includes(t)),
        ];
        setRecentRecordingTypes(recentActivityTypes);
        setRecordedRecordingTypes(recordedActivityTypes);
        set({
          recentActivityTypes,
          recordedActivityTypes,
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
          batteryOptDismissed:
            typeof parsed.batteryOptDismissed === 'boolean' ? parsed.batteryOptDismissed : false,
          alwaysLocationAsked:
            typeof parsed.alwaysLocationAsked === 'boolean' ? parsed.alwaysLocationAsked : false,
          notificationsAsked:
            typeof parsed.notificationsAsked === 'boolean' ? parsed.notificationsAsked : false,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      if (__DEV__) {
        console.warn('[RecordingPreferences] Failed to initialise');
      }
      set({ isLoaded: true });
    }
  },

  addRecentType: (type) => {
    if (parseRecordingType(type) === null) return;
    set((state) => {
      const filtered = state.recentActivityTypes.filter((t) => t !== type);
      const updated = [type, ...filtered].slice(0, 4);
      const recorded = [type, ...state.recordedActivityTypes.filter((t) => t !== type)];
      persistPreferences({
        ...state,
        recentActivityTypes: updated,
        recordedActivityTypes: recorded,
      });
      setRecentRecordingTypes(updated);
      setRecordedRecordingTypes(recorded);
      return { recentActivityTypes: updated, recordedActivityTypes: recorded };
    });
  },

  markAlwaysLocationAsked: () => {
    set((state) => {
      if (state.alwaysLocationAsked) return state;
      persistPreferences({ ...state, alwaysLocationAsked: true });
      return { alwaysLocationAsked: true };
    });
  },

  markNotificationsAsked: () => {
    set((state) => {
      if (state.notificationsAsked) return state;
      persistPreferences({ ...state, notificationsAsked: true });
      return { notificationsAsked: true };
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

  setSlotField: (mode, index, field) => {
    set((state) => {
      const current = fieldsForMode(state.dataFields, mode);
      const next = placeFieldInSlot(current, index, field);
      if (next === current) return state;
      const updated = { ...state.dataFields, [mode]: next };
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
    if (
      !Number.isFinite(metres) ||
      metres < ACCURACY_REJECT_BOUNDS_M.min ||
      metres > ACCURACY_REJECT_BOUNDS_M.max
    ) {
      return;
    }
    set((state) => {
      persistPreferences({ ...state, accuracyRejectThreshold: metres });
      return { accuracyRejectThreshold: metres };
    });
  },

  setAutoPauseDuration: (ms) => {
    if (
      !Number.isFinite(ms) ||
      ms < AUTO_PAUSE_DURATION_BOUNDS_MS.min ||
      ms > AUTO_PAUSE_DURATION_BOUNDS_MS.max
    ) {
      return;
    }
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

  dismissBatteryOptNudge: () => {
    set((state) => {
      persistPreferences({ ...state, batteryOptDismissed: true });
      return { batteryOptDismissed: true };
    });
  },
}));

async function persistPreferences(state: Partial<RecordingPreferencesState>): Promise<void> {
  try {
    const data = {
      recentActivityTypes: state.recentActivityTypes,
      recordedActivityTypes: state.recordedActivityTypes,
      autoPauseEnabled: state.autoPauseEnabled,
      autoPauseThresholds: state.autoPauseThresholds,
      dataFields: state.dataFields,
      autoUploadEnabled: state.autoUploadEnabled,
      gpsAccuracyMode: state.gpsAccuracyMode,
      accuracyRejectThreshold: state.accuracyRejectThreshold,
      autoPauseDurationMs: state.autoPauseDurationMs,
      keepAwakeEnabled: state.keepAwakeEnabled,
      batteryOptDismissed: state.batteryOptDismissed,
      alwaysLocationAsked: state.alwaysLocationAsked,
      notificationsAsked: state.notificationsAsked,
    };
    await setSetting(STORAGE_KEY, JSON.stringify(data));
  } catch {
    if (__DEV__) {
      console.warn('[RecordingPreferences] Failed to persist');
    }
  }
}

export async function initialiseRecordingPreferences(): Promise<void> {
  await useRecordingPreferences.getState().initialise();
}

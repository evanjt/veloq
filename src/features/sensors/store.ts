import { create } from 'zustand';

import { getSetting, setSetting } from '@/shared/storage';
// Deep store import (same pattern as settings/lib/backup.ts): the recording
// barrel would pull UI components into this lib-level module graph.
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type {
  DiscoveredSensor,
  KnownSensor,
  SensorConnection,
  SensorConnectionStatus,
  SensorKind,
  SensorSample,
} from './types';

const STORAGE_KEY = 'veloq-known-sensors';

/** A sensor value older than this is stale and no longer fed into recordings. */
export const SENSOR_STALE_MS = 5000;

interface SensorState {
  // Runtime
  scanning: boolean;
  discovered: DiscoveredSensor[];
  connections: Record<string, SensorConnection>;
  latest: Record<SensorKind, SensorSample | null>;
  // Persisted
  knownSensors: KnownSensor[];
  isLoaded: boolean;
  // Actions
  initialize: () => Promise<void>;
  setScanning: (scanning: boolean) => void;
  upsertDiscovered: (sensor: DiscoveredSensor) => void;
  clearDiscovered: () => void;
  setConnection: (id: string, connection: SensorConnection | null) => void;
  setConnectionStatus: (id: string, status: SensorConnectionStatus) => void;
  setBattery: (id: string, percent: number) => void;
  setLatest: (kind: SensorKind, value: number) => void;
  clearLatest: () => void;
  addKnownSensor: (sensor: KnownSensor) => void;
  removeKnownSensor: (id: string) => void;
}

export const useSensorStore = create<SensorState>((set, get) => ({
  scanning: false,
  discovered: [],
  connections: {},
  latest: { heartRate: null, power: null, cadence: null },
  knownSensors: [],
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        set({
          knownSensors: Array.isArray(parsed) ? (parsed as KnownSensor[]) : [],
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setScanning: (scanning) => set({ scanning }),

  upsertDiscovered: (sensor) => {
    set((state) => {
      const existing = state.discovered.findIndex((d) => d.id === sensor.id);
      if (existing >= 0) {
        const updated = [...state.discovered];
        updated[existing] = sensor;
        return { discovered: updated };
      }
      return { discovered: [...state.discovered, sensor] };
    });
  },

  clearDiscovered: () => set({ discovered: [] }),

  setConnection: (id, connection) => {
    set((state) => {
      const connections = { ...state.connections };
      if (connection) {
        connections[id] = connection;
      } else {
        delete connections[id];
      }
      return { connections };
    });
  },

  setConnectionStatus: (id, status) => {
    set((state) => {
      const existing = state.connections[id];
      if (!existing) return state;
      return { connections: { ...state.connections, [id]: { ...existing, status } } };
    });
  },

  setBattery: (id, percent) => {
    set((state) => {
      const existing = state.connections[id];
      if (!existing) return state;
      return {
        connections: { ...state.connections, [id]: { ...existing, batteryPercent: percent } },
      };
    });
  },

  setLatest: (kind, value) => {
    set((state) => ({
      latest: { ...state.latest, [kind]: { value, at: Date.now() } },
    }));
    // Mirror into the recording store's sample-and-hold so live recordings
    // pick sensor values up per point without a recording→sensors dependency.
    const recordingKind = kind === 'heartRate' ? 'heartrate' : kind;
    useRecordingStore.getState().setSensorSample(recordingKind, value);
  },

  clearLatest: () => set({ latest: { heartRate: null, power: null, cadence: null } }),

  addKnownSensor: (sensor) => {
    set((state) => {
      const filtered = state.knownSensors.filter((s) => s.id !== sensor.id);
      const updated = [...filtered, sensor];
      persistKnownSensors(updated);
      return { knownSensors: updated };
    });
  },

  removeKnownSensor: (id) => {
    set((state) => {
      const updated = state.knownSensors.filter((s) => s.id !== id);
      persistKnownSensors(updated);
      return { knownSensors: updated };
    });
  },
}));

async function persistKnownSensors(sensors: KnownSensor[]): Promise<void> {
  try {
    await setSetting(STORAGE_KEY, JSON.stringify(sensors));
  } catch {
    // Best effort persistence
  }
}

export async function initializeKnownSensors(): Promise<void> {
  await useSensorStore.getState().initialize();
}

/** Fresh (non-stale) latest value for a sensor kind, or null. */
export function getFreshSensorValue(kind: SensorKind, now = Date.now()): number | null {
  const sample = useSensorStore.getState().latest[kind];
  if (!sample) return null;
  if (now - sample.at > SENSOR_STALE_MS) return null;
  return sample.value;
}

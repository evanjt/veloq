import { create } from 'zustand';

import { getSetting, removeSetting, setSetting } from '@/shared/storage';
// Deep store import (same pattern as settings/lib/backup.ts): the recording
// barrel would pull UI components into this lib-level module graph.
import { useRecordingStore } from '@/features/recording';
import type {
  DiscoveredSensor,
  KnownSensor,
  SensorConnection,
  SensorAvailability,
  SensorConnectionStatus,
  SensorKind,
} from './types';

const STORAGE_KEY = 'veloq-known-sensors';

interface SensorState {
  // Runtime
  /** Written by the sensor manager only, from the permission, the adapter and BLE errors. */
  availability: SensorAvailability;
  scanning: boolean;
  /** The last scan ran its whole window, rather than being stopped. */
  scanFinished: boolean;
  discovered: DiscoveredSensor[];
  connections: Record<string, SensorConnection>;
  // Persisted
  knownSensors: KnownSensor[];
  isLoaded: boolean;
  // Actions
  initialise: () => Promise<void>;
  setAvailability: (availability: SensorAvailability) => void;
  setScanning: (scanning: boolean) => void;
  setScanFinished: (scanFinished: boolean) => void;
  upsertDiscovered: (sensor: DiscoveredSensor) => void;
  clearDiscovered: () => void;
  setConnection: (id: string, connection: SensorConnection | null) => void;
  setConnectionStatus: (id: string, status: SensorConnectionStatus) => void;
  setBattery: (id: string, percent: number) => void;
  /** Hand a notification's value to the recording store, which holds the live sample. */
  setLatest: (kind: SensorKind, value: number) => void;
  addKnownSensor: (sensor: KnownSensor) => void;
  removeKnownSensor: (id: string) => void;
}

export const useSensorStore = create<SensorState>((set) => ({
  availability: 'unknown',
  scanning: false,
  scanFinished: false,
  discovered: [],
  connections: {},
  knownSensors: [],
  isLoaded: false,

  initialise: async () => {
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

  setAvailability: (availability) => set({ availability }),

  setScanning: (scanning) => set({ scanning }),

  setScanFinished: (scanFinished) => set({ scanFinished }),

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
    // The recording store's sample-and-hold is the one live copy, with the one
    // stale window, and every tile and the recorder read it.
    const recordingKind = kind === 'heartRate' ? 'heartrate' : kind;
    useRecordingStore.getState().setSensorSample(recordingKind, value);
  },

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

export async function initialiseKnownSensors(): Promise<void> {
  await useSensorStore.getState().initialise();
}

/** Empties the paired and discovered sensors, in memory and in the settings. */
export async function forgetKnownSensors(): Promise<void> {
  useSensorStore.setState({ knownSensors: [], connections: {}, discovered: [] });
  await removeSetting(STORAGE_KEY).catch(() => {});
}

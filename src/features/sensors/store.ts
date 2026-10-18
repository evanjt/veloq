import { create } from 'zustand';

import { getSetting, removeSetting, setSetting } from '@/shared/storage';
// Deep store import (same pattern as settings/lib/backup.ts): the recording
// barrel would pull UI components into this lib-level module graph.
import { SENSOR_STALE_MS, useRecordingStore } from '@/features/recording';
import {
  chooseSensorSource,
  sensorSourceKey,
  type SensorSource,
  type SensorSourceOrigin,
} from './lib/sensorSource';
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
  /** The sensor each metric is recorded from, set only when it changes. */
  activeSources: Partial<Record<SensorKind, string>>;
  /** What each sensor has delivered, which can go beyond what it advertises: a power meter's crank cadence. */
  suppliedKinds: Record<string, SensorKind[]>;
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
  /** The received signal strength of a connected sensor, in dBm. */
  setSignal: (id: string, rssi: number) => void;
  /**
   * Hand a notification's value to the recording store, which holds the live
   * sample, when its sensor is the one source chosen for the metric.
   */
  setLatest: (
    kind: SensorKind,
    value: number,
    sensorId: string,
    origin?: SensorSourceOrigin
  ) => void;
  /** Forget what a sensor was supplying, once it is disconnected. */
  dropSources: (sensorId: string) => void;
  /** Record a metric from this sensor over any other paired sensor that supplies it. */
  setPreferredSource: (sensorId: string, kind: SensorKind) => void;
  addKnownSensor: (sensor: KnownSensor) => void;
  removeKnownSensor: (id: string) => void;
}

/**
 * When each source last sent, per metric. Outside the store state because it
 * moves on every notification, and nothing renders it.
 */
const sourceSamples: Record<SensorKind, Map<string, SensorSource>> = {
  heartRate: new Map(),
  power: new Map(),
  cadence: new Map(),
};

function forgetSourceSamples(sensorId?: string): void {
  for (const sources of Object.values(sourceSamples)) {
    if (sensorId === undefined) {
      sources.clear();
      continue;
    }
    for (const [key, source] of sources) {
      if (source.sensorId === sensorId) sources.delete(key);
    }
  }
}

export const useSensorStore = create<SensorState>((set, get) => ({
  availability: 'unknown',
  scanning: false,
  scanFinished: false,
  discovered: [],
  connections: {},
  knownSensors: [],
  isLoaded: false,
  activeSources: {},
  suppliedKinds: {},

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

  setSignal: (id, rssi) => {
    set((state) => {
      const existing = state.connections[id];
      if (!existing || existing.rssi === rssi) return state;
      return { connections: { ...state.connections, [id]: { ...existing, rssi } } };
    });
  },

  setLatest: (kind, value, sensorId, origin = 'dedicated') => {
    const now = Date.now();
    const incoming: SensorSource = { sensorId, origin, lastSampleAt: now };
    const sources = sourceSamples[kind];
    sources.set(sensorSourceKey(incoming), incoming);

    const { knownSensors, activeSources, suppliedKinds } = get();
    const supplied = suppliedKinds[sensorId] ?? [];
    if (!supplied.includes(kind)) {
      set({ suppliedKinds: { ...suppliedKinds, [sensorId]: [...supplied, kind] } });
    }

    // A source that falls silent for as long as the recording store holds a
    // sample hands over, so the stream never records the gap while another
    // sensor is still sending.
    const chosen = chooseSensorSource(kind, [...sources.values()], {
      knownSensors,
      now,
      staleMs: SENSOR_STALE_MS,
    });
    if (!chosen || sensorSourceKey(chosen) !== sensorSourceKey(incoming)) return;
    if (activeSources[kind] !== sensorId) {
      set({ activeSources: { ...get().activeSources, [kind]: sensorId } });
    }

    // The recording store's sample-and-hold is the one live copy, with the one
    // stale window, and every tile and the recorder read it.
    const recordingKind = kind === 'heartRate' ? 'heartrate' : kind;
    useRecordingStore.getState().setSensorSample(recordingKind, value);
  },

  dropSources: (sensorId) => {
    forgetSourceSamples(sensorId);
    set((state) => {
      const activeSources = Object.fromEntries(
        Object.entries(state.activeSources).filter(([, id]) => id !== sensorId)
      );
      const suppliedKinds = { ...state.suppliedKinds };
      delete suppliedKinds[sensorId];
      return { activeSources, suppliedKinds };
    });
  },

  setPreferredSource: (sensorId, kind) => {
    set((state) => {
      const updated = state.knownSensors.map((sensor) => {
        const others = (sensor.preferredFor ?? []).filter((k) => k !== kind);
        const preferredFor = sensor.id === sensorId ? [...others, kind] : others;
        const { preferredFor: _previous, ...rest } = sensor;
        return preferredFor.length > 0 ? { ...rest, preferredFor } : rest;
      });
      persistKnownSensors(updated);
      return { knownSensors: updated };
    });
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
    get().dropSources(id);
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
  forgetSourceSamples();
  useSensorStore.setState({
    knownSensors: [],
    connections: {},
    discovered: [],
    activeSources: {},
    suppliedKinds: {},
  });
  await removeSetting(STORAGE_KEY).catch(() => {});
}

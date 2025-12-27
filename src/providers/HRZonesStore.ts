import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HR_ZONES_KEY = 'veloq-hr-zones';

// Default HR Zone definitions (percentage of max HR)
export interface HRZone {
  id: number;
  name: string;
  min: number; // Percentage of max HR (0-1)
  max: number;
  color: string;
}

export const DEFAULT_HR_ZONES: HRZone[] = [
  { id: 1, name: 'Recovery', min: 0.5, max: 0.6, color: '#90CAF9' },
  { id: 2, name: 'Endurance', min: 0.6, max: 0.7, color: '#4CAF50' },
  { id: 3, name: 'Tempo', min: 0.7, max: 0.8, color: '#FFEB3B' },
  { id: 4, name: 'Threshold', min: 0.8, max: 0.9, color: '#FF9800' },
  { id: 5, name: 'VO2max', min: 0.9, max: 1.0, color: '#F44336' },
];

export interface HRZonesSettings {
  maxHR: number;
  zones: HRZone[];
}

interface HRZonesState {
  maxHR: number;
  zones: HRZone[];
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setMaxHR: (maxHR: number) => Promise<void>;
  setZoneThreshold: (zoneId: number, min: number, max: number) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

export const useHRZones = create<HRZonesState>((set, get) => ({
  maxHR: 190, // Default max HR
  zones: DEFAULT_HR_ZONES,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(HR_ZONES_KEY);
      if (stored) {
        const parsed: HRZonesSettings = JSON.parse(stored);
        set({
          maxHR: parsed.maxHR || 190,
          zones: parsed.zones || DEFAULT_HR_ZONES,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setMaxHR: async (maxHR: number) => {
    const { zones } = get();
    const settings: HRZonesSettings = { maxHR, zones };
    await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify(settings));
    set({ maxHR });
  },

  setZoneThreshold: async (zoneId: number, min: number, max: number) => {
    const { maxHR, zones } = get();
    const updatedZones = zones.map(zone =>
      zone.id === zoneId ? { ...zone, min, max } : zone
    );
    const settings: HRZonesSettings = { maxHR, zones: updatedZones };
    await AsyncStorage.setItem(HR_ZONES_KEY, JSON.stringify(settings));
    set({ zones: updatedZones });
  },

  resetToDefaults: async () => {
    await AsyncStorage.removeItem(HR_ZONES_KEY);
    set({
      maxHR: 190,
      zones: DEFAULT_HR_ZONES,
    });
  },
}));

// Helper for synchronous access
export function getHRZones(): { maxHR: number; zones: HRZone[] } {
  const state = useHRZones.getState();
  return { maxHR: state.maxHR, zones: state.zones };
}

// Initialize HR zones (call during app startup)
export async function initializeHRZones(): Promise<void> {
  await useHRZones.getState().initialize();
}

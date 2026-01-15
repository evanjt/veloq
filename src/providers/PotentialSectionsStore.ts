import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PotentialSection } from '@/types';

const POTENTIAL_SECTIONS_KEY = 'veloq-potential-sections';

/**
 * Type guard for PotentialSection
 */
function isPotentialSection(value: unknown): value is PotentialSection {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.sportType === 'string' &&
    Array.isArray(obj.polyline) &&
    Array.isArray(obj.activityIds) &&
    typeof obj.visitCount === 'number' &&
    typeof obj.distanceMeters === 'number' &&
    typeof obj.confidence === 'number' &&
    typeof obj.scale === 'string'
  );
}

/**
 * Type guard for PotentialSection array
 */
function isPotentialSectionArray(value: unknown): value is PotentialSection[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return isPotentialSection(value[0]);
}

interface PotentialSectionsState {
  potentials: PotentialSection[];
  isLoaded: boolean;
  lastDetection: number | null; // Timestamp of last detection

  // Actions
  initialize: () => Promise<void>;
  setPotentials: (potentials: PotentialSection[]) => Promise<void>;
  clear: () => Promise<void>;
}

export const usePotentialSections = create<PotentialSectionsState>((set, get) => ({
  potentials: [],
  isLoaded: false,
  lastDetection: null,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isPotentialSectionArray(parsed)) {
          set({
            potentials: parsed,
            isLoaded: true,
          });
        } else {
          set({ isLoaded: true });
        }
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setPotentials: async (potentials: PotentialSection[]) => {
    const data = {
      potentials,
      lastDetection: Date.now(),
    };
    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify(data));
    set({
      potentials,
      lastDetection: Date.now(),
    });
  },

  clear: async () => {
    await AsyncStorage.removeItem(POTENTIAL_SECTIONS_KEY);
    set({
      potentials: [],
      lastDetection: null,
    });
  },
}));

// Helper for synchronous access
export function getPotentialSections(): PotentialSection[] {
  return usePotentialSections.getState().potentials;
}

// Initialize potential sections (call during app startup)
export async function initializePotentialSections(): Promise<void> {
  await usePotentialSections.getState().initialize();
}

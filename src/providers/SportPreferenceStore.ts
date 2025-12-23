import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';

export type PrimarySport = 'Cycling' | 'Running' | 'Swimming';

// Map primary sport to activity types used in API calls
export const SPORT_API_TYPES: Record<PrimarySport, string[]> = {
  Cycling: ['Ride', 'VirtualRide'],
  Running: ['Run', 'VirtualRun', 'TrailRun'],
  Swimming: ['Swim', 'OpenWaterSwim'],
};

// Sport-specific colors
export const SPORT_COLORS: Record<PrimarySport, string> = {
  Cycling: '#FF6B00',
  Running: '#4CAF50',
  Swimming: '#2196F3',
};

interface SportPreferenceState {
  primarySport: PrimarySport;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setPrimarySport: (sport: PrimarySport) => Promise<void>;
}

export const useSportPreference = create<SportPreferenceState>((set) => ({
  primarySport: 'Cycling', // Default
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(SPORT_PREFERENCE_KEY);
      if (stored && ['Cycling', 'Running', 'Swimming'].includes(stored)) {
        set({
          primarySport: stored as PrimarySport,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch (error) {
      console.error('Failed to load sport preference:', error);
      set({ isLoaded: true });
    }
  },

  setPrimarySport: async (sport: PrimarySport) => {
    try {
      await AsyncStorage.setItem(SPORT_PREFERENCE_KEY, sport);
      set({ primarySport: sport });
    } catch (error) {
      console.error('Failed to save sport preference:', error);
      throw error;
    }
  },
}));

// Helper for synchronous access (e.g., in API calls or non-React contexts)
export function getPrimarySport(): PrimarySport {
  return useSportPreference.getState().primarySport;
}

// Initialize sport preference (call during app startup)
export async function initializeSportPreference(): Promise<void> {
  await useSportPreference.getState().initialize();
}

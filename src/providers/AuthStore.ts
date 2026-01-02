import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { Athlete } from '@/types';

const API_KEY_STORAGE_KEY = 'intervals_api_key';
const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';

// Demo mode athlete ID
export const DEMO_ATHLETE_ID = 'demo';

interface AuthState {
  apiKey: string | null;
  athleteId: string | null;
  athlete: Athlete | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  hideDemoBanner: boolean;

  // Actions
  initialize: () => Promise<void>;
  setCredentials: (apiKey: string, athleteId: string) => Promise<void>;
  clearCredentials: () => Promise<void>;
  setAthlete: (athlete: Athlete) => void;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  setHideDemoBanner: (hide: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  apiKey: null,
  athleteId: null,
  athlete: null,
  isLoading: true,
  isAuthenticated: false,
  isDemoMode: false,
  hideDemoBanner: false,

  initialize: async () => {
    try {
      const [apiKey, athleteId] = await Promise.all([
        SecureStore.getItemAsync(API_KEY_STORAGE_KEY),
        SecureStore.getItemAsync(ATHLETE_ID_STORAGE_KEY),
      ]);

      const isAuthenticated = !!(apiKey && athleteId);

      set({
        apiKey,
        athleteId,
        isAuthenticated,
        isLoading: false,
        isDemoMode: false,
      });
    } catch {
      set({ isLoading: false, isAuthenticated: false, isDemoMode: false });
    }
  },

  setCredentials: async (apiKey: string, athleteId: string) => {
    await Promise.all([
      SecureStore.setItemAsync(API_KEY_STORAGE_KEY, apiKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      }),
      SecureStore.setItemAsync(ATHLETE_ID_STORAGE_KEY, athleteId, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      }),
    ]);

    set({
      apiKey,
      athleteId,
      isAuthenticated: true,
      isDemoMode: false,
    });
  },

  clearCredentials: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
      SecureStore.deleteItemAsync(ATHLETE_ID_STORAGE_KEY),
    ]);

    set({
      apiKey: null,
      athleteId: null,
      athlete: null,
      isAuthenticated: false,
      isDemoMode: false,
    });
  },

  setAthlete: (athlete: Athlete) => {
    set({ athlete });
  },

  enterDemoMode: () => {
    set({
      athleteId: DEMO_ATHLETE_ID,
      isAuthenticated: true,
      isDemoMode: true,
      athlete: null,
    });
  },

  exitDemoMode: () => {
    set({
      athleteId: null,
      isAuthenticated: false,
      isDemoMode: false,
      hideDemoBanner: false,
      athlete: null,
    });
  },

  setHideDemoBanner: (hide: boolean) => {
    set({ hideDemoBanner: hide });
  },
}));

// Helper to get credentials for API client (synchronous access)
export function getStoredCredentials(): {
  apiKey: string | null;
  athleteId: string | null;
} {
  const state = useAuthStore.getState();
  return {
    apiKey: state.apiKey,
    athleteId: state.athleteId,
  };
}

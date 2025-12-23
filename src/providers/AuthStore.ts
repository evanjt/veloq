import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const API_KEY_STORAGE_KEY = 'intervals_api_key';
const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';

interface AuthState {
  apiKey: string | null;
  athleteId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  initialize: () => Promise<void>;
  setCredentials: (apiKey: string, athleteId: string) => Promise<void>;
  clearCredentials: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  apiKey: null,
  athleteId: null,
  isLoading: true,
  isAuthenticated: false,

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
      });
    } catch {
      set({ isLoading: false, isAuthenticated: false });
    }
  },

  setCredentials: async (apiKey: string, athleteId: string) => {
    try {
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
      });
    } catch (error) {
      throw error;
    }
  },

  clearCredentials: async () => {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
        SecureStore.deleteItemAsync(ATHLETE_ID_STORAGE_KEY),
      ]);

      set({
        apiKey: null,
        athleteId: null,
        isAuthenticated: false,
      });
    } catch (error) {
      throw error;
    }
  },
}));

// Helper to get credentials for API client (synchronous access)
export function getStoredCredentials(): { apiKey: string | null; athleteId: string | null } {
  const state = useAuthStore.getState();
  return {
    apiKey: state.apiKey,
    athleteId: state.athleteId,
  };
}

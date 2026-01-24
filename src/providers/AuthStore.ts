import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { Athlete } from '@/types';

// Lazy import to avoid circular dependencies
function getRouteEngine() {
  try {
    const module = require('veloqrs');
    return module.routeEngine || module.default?.routeEngine || null;
  } catch {
    return null;
  }
}

const API_KEY_STORAGE_KEY = 'intervals_api_key';
const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';
const ACCESS_TOKEN_STORAGE_KEY = 'intervals_access_token';

// Demo mode athlete ID
export const DEMO_ATHLETE_ID = 'demo';

// Auth method type
export type AuthMethod = 'oauth' | 'apiKey' | 'demo' | null;

// Session expiry reason
export type SessionExpiredReason = 'token_expired' | 'token_revoked' | null;

interface AuthState {
  apiKey: string | null;
  accessToken: string | null;
  athleteId: string | null;
  athlete: Athlete | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  hideDemoBanner: boolean;
  authMethod: AuthMethod;
  /** Set when OAuth session expires due to 401 response */
  sessionExpired: SessionExpiredReason;

  // Actions
  initialize: () => Promise<void>;
  setCredentials: (apiKey: string, athleteId: string) => Promise<void>;
  setOAuthCredentials: (
    accessToken: string,
    athleteId: string,
    athleteName?: string
  ) => Promise<void>;
  clearCredentials: () => Promise<void>;
  setAthlete: (athlete: Athlete) => void;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  setHideDemoBanner: (hide: boolean) => void;
  /** Called when OAuth token is rejected with 401 - clears OAuth credentials */
  handleSessionExpired: (reason?: SessionExpiredReason) => Promise<void>;
  /** Clear the session expired state (e.g., after user acknowledges) */
  clearSessionExpired: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  apiKey: null,
  accessToken: null,
  athleteId: null,
  athlete: null,
  isLoading: true,
  isAuthenticated: false,
  isDemoMode: false,
  hideDemoBanner: false,
  authMethod: null,
  sessionExpired: null,

  initialize: async () => {
    try {
      const [apiKey, athleteId, accessToken] = await Promise.all([
        SecureStore.getItemAsync(API_KEY_STORAGE_KEY),
        SecureStore.getItemAsync(ATHLETE_ID_STORAGE_KEY),
        SecureStore.getItemAsync(ACCESS_TOKEN_STORAGE_KEY),
      ]);

      // Determine auth method: OAuth takes priority over API key
      let authMethod: AuthMethod = null;
      let isAuthenticated = false;

      if (accessToken && athleteId) {
        authMethod = 'oauth';
        isAuthenticated = true;
      } else if (apiKey && athleteId) {
        authMethod = 'apiKey';
        isAuthenticated = true;
      } else {
        // No valid credentials found - clear any stale route engine data
        // This handles the case where demo mode was active but app was restarted
        // (demo mode doesn't persist, but SQLite cache does)
        const engine = getRouteEngine();
        if (engine) {
          engine.clear();
          if (__DEV__) {
            console.log('[AuthStore] Cleared route engine - no persisted credentials');
          }
        }
      }

      set({
        apiKey,
        accessToken,
        athleteId,
        isAuthenticated,
        isLoading: false,
        isDemoMode: false,
        authMethod,
      });
    } catch {
      set({
        isLoading: false,
        isAuthenticated: false,
        isDemoMode: false,
        authMethod: null,
      });
    }
  },

  setCredentials: async (apiKey: string, athleteId: string) => {
    await Promise.all([
      SecureStore.setItemAsync(API_KEY_STORAGE_KEY, apiKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      SecureStore.setItemAsync(ATHLETE_ID_STORAGE_KEY, athleteId, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      // Clear OAuth token when using API key auth
      SecureStore.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY),
    ]);

    set({
      apiKey,
      accessToken: null,
      athleteId,
      isAuthenticated: true,
      isDemoMode: false,
      authMethod: 'apiKey',
    });
  },

  setOAuthCredentials: async (accessToken: string, athleteId: string, athleteName?: string) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, accessToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      SecureStore.setItemAsync(ATHLETE_ID_STORAGE_KEY, athleteId, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
      // Clear API key when using OAuth
      SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
    ]);

    set({
      accessToken,
      apiKey: null,
      athleteId,
      isAuthenticated: true,
      isDemoMode: false,
      authMethod: 'oauth',
      // Set basic athlete info if provided
      athlete: athleteName ? ({ id: athleteId, name: athleteName } as Athlete) : null,
    });
  },

  clearCredentials: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY),
      SecureStore.deleteItemAsync(ATHLETE_ID_STORAGE_KEY),
      SecureStore.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY),
    ]);

    set({
      apiKey: null,
      accessToken: null,
      athleteId: null,
      athlete: null,
      isAuthenticated: false,
      isDemoMode: false,
      authMethod: null,
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
      authMethod: 'demo',
      athlete: null,
    });
  },

  exitDemoMode: () => {
    set({
      athleteId: null,
      isAuthenticated: false,
      isDemoMode: false,
      hideDemoBanner: false,
      authMethod: null,
      athlete: null,
    });
  },

  setHideDemoBanner: (hide: boolean) => {
    set({ hideDemoBanner: hide });
  },

  handleSessionExpired: async (reason: SessionExpiredReason = 'token_expired') => {
    const { authMethod } = get();

    // Only handle session expiry for OAuth auth method
    if (authMethod !== 'oauth') {
      return;
    }

    // Clear OAuth credentials from storage
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY),
      SecureStore.deleteItemAsync(ATHLETE_ID_STORAGE_KEY),
    ]);

    // Update state to logged out with session expired reason
    set({
      accessToken: null,
      athleteId: null,
      athlete: null,
      isAuthenticated: false,
      authMethod: null,
      sessionExpired: reason,
    });
  },

  clearSessionExpired: () => {
    set({ sessionExpired: null });
  },
}));

// Helper to get credentials for API client (synchronous access)
export function getStoredCredentials(): {
  apiKey: string | null;
  accessToken: string | null;
  athleteId: string | null;
  authMethod: AuthMethod;
} {
  const state = useAuthStore.getState();
  return {
    apiKey: state.apiKey,
    accessToken: state.accessToken,
    athleteId: state.athleteId,
    authMethod: state.authMethod,
  };
}

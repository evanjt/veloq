import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'veloq-insights-last-seen';

interface InsightsState {
  lastSeenTimestamp: number;
  hasNewInsights: boolean;
  isLoaded: boolean;
  initialize: () => Promise<void>;
  markSeen: () => void;
  setHasNewInsights: (value: boolean) => void;
}

export const useInsightsStore = create<InsightsState>((set, get) => ({
  lastSeenTimestamp: 0,
  hasNewInsights: false,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'number' && Number.isFinite(parsed)) {
          set({ lastSeenTimestamp: parsed, isLoaded: true });
          return;
        }
      }
    } catch {
      // Ignore parse errors
    }
    set({ isLoaded: true });
  },

  markSeen: () => {
    const now = Date.now();
    set({ lastSeenTimestamp: now, hasNewInsights: false });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(now)).catch(() => {});
  },

  setHasNewInsights: (value: boolean) => {
    set({ hasNewInsights: value });
  },
}));

export async function initializeInsightsStore(): Promise<void> {
  await useInsightsStore.getState().initialize();
}

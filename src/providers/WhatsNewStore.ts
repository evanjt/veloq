import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WHATS_NEW_KEY = 'veloq-whats-new-seen';

interface TourState {
  mode: 'whatsNew' | 'tutorial';
  resumeIndex: number;
  exploring: boolean;
  tip: string | null;
}

interface WhatsNewState {
  lastSeenVersion: string | null;
  isLoaded: boolean;
  tourState: TourState | null;

  initialize: () => Promise<void>;
  markSeen: (version: string) => Promise<void>;

  startTour: (mode: 'whatsNew' | 'tutorial') => void;
  showMe: (nextIndex: number, tip?: string) => void;
  resumeTour: () => void;
  endTour: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  lastSeenVersion: null,
  isLoaded: false,
  tourState: null,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(WHATS_NEW_KEY);
      if (stored) {
        set({ lastSeenVersion: stored, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  markSeen: async (version: string) => {
    await AsyncStorage.setItem(WHATS_NEW_KEY, version);
    set({ lastSeenVersion: version });
  },

  startTour: (mode) => {
    set({ tourState: { mode, resumeIndex: 0, exploring: false, tip: null } });
  },

  showMe: (nextIndex, tip) => {
    set((state) => {
      if (!state.tourState) return state;
      return {
        tourState: {
          ...state.tourState,
          resumeIndex: nextIndex,
          exploring: true,
          tip: tip ?? null,
        },
      };
    });
  },

  resumeTour: () => {
    set((state) => {
      if (!state.tourState) return state;
      return { tourState: { ...state.tourState, exploring: false } };
    });
  },

  endTour: () => {
    set({ tourState: null });
  },
}));

export async function initializeWhatsNewStore(): Promise<void> {
  await useWhatsNewStore.getState().initialize();
}

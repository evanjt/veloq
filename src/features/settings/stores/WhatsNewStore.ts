import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import type { LaunchModal } from '../lib/launchSurfaces';
import type { FoundBackup } from '../lib/restorePrompt';

const WHATS_NEW_KEY = 'veloq-whats-new-seen';

interface TourState {
  mode: 'whatsNew' | 'tutorial';
  /** The slide whose Show Me was used, or null before any was. */
  shownIndex: number | null;
  resumeIndex: number;
  exploring: boolean;
  tip: string | null;
}

interface WhatsNewState {
  lastSeenVersion: string | null;
  isLoaded: boolean;
  tourState: TourState | null;
  /**
   * The modal this launch raised, which holds its one slot. Never persisted, so
   * a relaunch starts empty and a tour that lost the slot opens then.
   */
  launchModal: LaunchModal | null;
  /** The backup found for an empty library while the offer is unanswered, else null. */
  restoreOffer: FoundBackup | null;

  initialise: () => Promise<void>;
  markSeen: (version: string) => Promise<void>;

  startTour: (mode: 'whatsNew' | 'tutorial') => void;
  showMe: (shownIndex: number, nextIndex: number, tip?: string) => void;
  resumeTour: () => void;
  endTour: () => void;
  dismissTour: (currentVersion: string) => Promise<void>;
  takeLaunchSlot: (modal: LaunchModal) => void;
  setRestoreOffer: (offer: FoundBackup | null) => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  lastSeenVersion: null,
  isLoaded: false,
  tourState: null,
  launchModal: null,
  restoreOffer: null,

  initialise: async () => {
    try {
      const stored = await getSetting(WHATS_NEW_KEY);
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
    await setSetting(WHATS_NEW_KEY, version);
    set({ lastSeenVersion: version });
  },

  startTour: (mode) => {
    set({ tourState: { mode, shownIndex: null, resumeIndex: 0, exploring: false, tip: null } });
  },

  showMe: (shownIndex, nextIndex, tip) => {
    set((state) => {
      if (!state.tourState) return state;
      return {
        tourState: {
          ...state.tourState,
          shownIndex,
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

  // A tour left early still counts as seen, or it reopens on every launch.
  dismissTour: async (currentVersion) => {
    const { lastSeenVersion, markSeen } = get();
    set({ tourState: null });
    if (lastSeenVersion !== currentVersion) {
      await markSeen(currentVersion);
    }
  },

  takeLaunchSlot: (modal) => {
    if (get().launchModal === null) set({ launchModal: modal });
  },

  setRestoreOffer: (offer) => set({ restoreOffer: offer }),
}));

export async function initialiseWhatsNewStore(): Promise<void> {
  await useWhatsNewStore.getState().initialise();
}

import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import type { SportFamily } from '@/shared/activity/sportCategories';

const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';

export type PrimarySport = 'Cycling' | 'Running' | 'Swimming';

/** The family each preference draws its mark in. */
export const PRIMARY_SPORT_FAMILY: Record<PrimarySport, SportFamily> = {
  Cycling: 'Ride',
  Running: 'Run',
  Swimming: 'Water',
};

const SPORT_DEFAULT_KEY = 'veloq-primary-sport-default';

const SPORTS: readonly string[] = ['Cycling', 'Running', 'Swimming'];

function asSport(value: string | null | undefined): PrimarySport | null {
  return value && SPORTS.includes(value) ? (value as PrimarySport) : null;
}

interface SportPreferenceState {
  primarySport: PrimarySport;
  /** Whether the athlete picked the sport, rather than it following the library. */
  isChosen: boolean;
  isLoaded: boolean;

  // Actions
  initialise: () => Promise<void>;
  setPrimarySport: (sport: PrimarySport) => Promise<void>;
  /**
   * Take the sport the engine names dominant in the library, unless the
   * athlete chose one. The default is stored under its own key, so the next
   * launch opens on it before any read and a choice made later still wins.
   */
  adoptLibrarySport: (dominant: string | null | undefined) => Promise<void>;
}

export const useSportPreference = create<SportPreferenceState>((set, get) => ({
  primarySport: 'Cycling', // Until a choice or the library says otherwise
  isChosen: false,
  isLoaded: false,

  initialise: async () => {
    try {
      const chosen = asSport(await getSetting(SPORT_PREFERENCE_KEY));
      if (chosen) {
        set({ primarySport: chosen, isChosen: true, isLoaded: true });
        return;
      }
      const fallback = asSport(await getSetting(SPORT_DEFAULT_KEY));
      set({
        ...(fallback ? { primarySport: fallback } : {}),
        isChosen: false,
        isLoaded: true,
      });
    } catch {
      set({ isLoaded: true });
    }
  },

  setPrimarySport: async (sport: PrimarySport) => {
    await setSetting(SPORT_PREFERENCE_KEY, sport);
    set({ primarySport: sport, isChosen: true });
  },

  adoptLibrarySport: async (dominant) => {
    const sport = asSport(dominant);
    const { isLoaded, isChosen, primarySport } = get();
    if (!sport || !isLoaded || isChosen || sport === primarySport) return;
    set({ primarySport: sport });
    await setSetting(SPORT_DEFAULT_KEY, sport);
  },
}));

// Initialise sport preference (call during app startup)
export async function initialiseSportPreference(): Promise<void> {
  await useSportPreference.getState().initialise();
}

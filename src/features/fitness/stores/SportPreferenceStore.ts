import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { colors, darkColors } from '@/theme';

const SPORT_PREFERENCE_KEY = 'veloq-primary-sport';

export type PrimarySport = 'Cycling' | 'Running' | 'Swimming';

/**
 * The palette's activity colours under the names the preference uses. These
 * were three hex literals byte for byte equal to the palette, so a palette fix
 * reached every surface except the ones reading this store.
 */
export const SPORT_COLORS: Record<PrimarySport, string> = {
  Cycling: colors.ride,
  Running: colors.run,
  Swimming: colors.swim,
};

/**
 * The same three hues as text. The fills sit between 2.18:1 and 3.31:1 on white
 * and a threshold headline is set in the sport's colour, where the hue is the
 * information rather than decoration, so these carry the same hue at 4.5:1.
 * Measured in `textContrast.test.ts`.
 */
export const SPORT_TEXT_COLORS: Record<PrimarySport, string> = {
  Cycling: colors.rideText,
  Running: colors.runText,
  Swimming: colors.swimText,
};

export const SPORT_TEXT_COLORS_DARK: Record<PrimarySport, string> = {
  Cycling: darkColors.rideText,
  Running: darkColors.runText,
  Swimming: darkColors.swimText,
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
      const stored = await getSetting(SPORT_PREFERENCE_KEY);
      if (stored && ['Cycling', 'Running', 'Swimming'].includes(stored)) {
        set({
          primarySport: stored as PrimarySport,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setPrimarySport: async (sport: PrimarySport) => {
    await setSetting(SPORT_PREFERENCE_KEY, sport);
    set({ primarySport: sport });
  },
}));

// Initialize sport preference (call during app startup)
export async function initializeSportPreference(): Promise<void> {
  await useSportPreference.getState().initialize();
}

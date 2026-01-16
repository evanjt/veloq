/**
 * Store for tracking which auto-detected sections are superseded by custom sections.
 *
 * When a custom section overlaps significantly (>80%) with an auto-detected section,
 * the auto-detected section is "superseded" and should be hidden from the UI.
 *
 * This pre-computation happens when custom sections are created, avoiding expensive
 * overlap calculations during UI navigation.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPERSEDED_SECTIONS_KEY = 'veloq-superseded-sections';

interface SupersededSectionsState {
  /**
   * Map of custom section ID -> array of auto section IDs it supersedes.
   */
  supersededBy: Record<string, string[]>;

  /**
   * Whether the store has been initialized from storage.
   */
  isLoaded: boolean;

  /**
   * Initialize from AsyncStorage.
   */
  initialize: () => Promise<void>;

  /**
   * Set the list of auto sections superseded by a custom section.
   */
  setSuperseded: (customSectionId: string, autoSectionIds: string[]) => Promise<void>;

  /**
   * Remove superseded entries for a custom section (when it's deleted).
   */
  removeSuperseded: (customSectionId: string) => Promise<void>;

  /**
   * Check if an auto section is superseded by any custom section.
   */
  isSuperseded: (autoSectionId: string) => boolean;

  /**
   * Get all superseded auto section IDs.
   */
  getAllSuperseded: () => Set<string>;

  /**
   * Clear all superseded data.
   */
  clear: () => Promise<void>;
}

export const useSupersededSections = create<SupersededSectionsState>((set, get) => ({
  supersededBy: {},
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) {
          set({ supersededBy: parsed, isLoaded: true });
          return;
        }
      }
      set({ isLoaded: true });
    } catch {
      set({ isLoaded: true });
    }
  },

  setSuperseded: async (customSectionId: string, autoSectionIds: string[]) => {
    const newState = {
      ...get().supersededBy,
      [customSectionId]: autoSectionIds,
    };
    await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, JSON.stringify(newState));
    set({ supersededBy: newState });
  },

  removeSuperseded: async (customSectionId: string) => {
    const { [customSectionId]: _, ...rest } = get().supersededBy;
    await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, JSON.stringify(rest));
    set({ supersededBy: rest });
  },

  isSuperseded: (autoSectionId: string): boolean => {
    const { supersededBy } = get();
    for (const autoIds of Object.values(supersededBy)) {
      if (autoIds.includes(autoSectionId)) {
        return true;
      }
    }
    return false;
  },

  getAllSuperseded: (): Set<string> => {
    const { supersededBy } = get();
    const result = new Set<string>();
    for (const autoIds of Object.values(supersededBy)) {
      for (const id of autoIds) {
        result.add(id);
      }
    }
    return result;
  },

  clear: async () => {
    await AsyncStorage.removeItem(SUPERSEDED_SECTIONS_KEY);
    set({ supersededBy: {} });
  },
}));

/**
 * Initialize superseded sections store (call during app startup).
 */
export async function initializeSupersededSections(): Promise<void> {
  await useSupersededSections.getState().initialize();
}

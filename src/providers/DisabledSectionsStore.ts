/**
 * Store for tracking user-disabled auto-detected sections.
 *
 * Disabled sections are hidden from activity detail pages but remain
 * visible (at the bottom) in the sections list for re-enabling.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISABLED_SECTIONS_KEY = 'veloq-disabled-sections';

interface DisabledSectionsState {
  /**
   * Set of disabled section IDs.
   */
  disabledIds: Set<string>;

  /**
   * Whether the store has been initialized from storage.
   */
  isLoaded: boolean;

  /**
   * Initialize from AsyncStorage.
   */
  initialize: () => Promise<void>;

  /**
   * Disable a section (hide from activity details).
   */
  disable: (sectionId: string) => Promise<void>;

  /**
   * Re-enable a section.
   */
  enable: (sectionId: string) => Promise<void>;

  /**
   * Check if a section is disabled.
   */
  isDisabled: (sectionId: string) => boolean;

  /**
   * Get all disabled section IDs.
   */
  getAllDisabled: () => Set<string>;

  /**
   * Clear all disabled sections.
   */
  clear: () => Promise<void>;
}

export const useDisabledSections = create<DisabledSectionsState>((set, get) => ({
  disabledIds: new Set(),
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(DISABLED_SECTIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          set({ disabledIds: new Set(parsed), isLoaded: true });
          return;
        }
      }
      set({ isLoaded: true });
    } catch {
      set({ isLoaded: true });
    }
  },

  disable: async (sectionId: string) => {
    const newSet = new Set(get().disabledIds);
    newSet.add(sectionId);
    await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify([...newSet]));
    set({ disabledIds: newSet });
  },

  enable: async (sectionId: string) => {
    const newSet = new Set(get().disabledIds);
    newSet.delete(sectionId);
    await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify([...newSet]));
    set({ disabledIds: newSet });
  },

  isDisabled: (sectionId: string): boolean => {
    return get().disabledIds.has(sectionId);
  },

  getAllDisabled: (): Set<string> => {
    return new Set(get().disabledIds);
  },

  clear: async () => {
    await AsyncStorage.removeItem(DISABLED_SECTIONS_KEY);
    set({ disabledIds: new Set() });
  },
}));

/**
 * Initialize disabled sections store (call during app startup).
 */
export async function initializeDisabledSections(): Promise<void> {
  await useDisabledSections.getState().initialize();
}

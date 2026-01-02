import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISSALS_KEY = 'veloq-section-dismissals';

/**
 * Type guard for string array
 */
function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return typeof value[0] === 'string';
}

interface SectionDismissalsState {
  dismissedIds: Set<string>;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  dismiss: (sectionId: string) => Promise<void>;
  restore: (sectionId: string) => Promise<void>;
  isDismissed: (sectionId: string) => boolean;
  clear: () => Promise<void>;
}

export const useSectionDismissals = create<SectionDismissalsState>((set, get) => ({
  dismissedIds: new Set(),
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(DISMISSALS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isStringArray(parsed)) {
          set({
            dismissedIds: new Set(parsed),
            isLoaded: true,
          });
        } else {
          set({ isLoaded: true });
        }
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  dismiss: async (sectionId: string) => {
    const { dismissedIds } = get();
    const updated = new Set(dismissedIds);
    updated.add(sectionId);
    await AsyncStorage.setItem(DISMISSALS_KEY, JSON.stringify([...updated]));
    set({ dismissedIds: updated });
  },

  restore: async (sectionId: string) => {
    const { dismissedIds } = get();
    const updated = new Set(dismissedIds);
    updated.delete(sectionId);
    await AsyncStorage.setItem(DISMISSALS_KEY, JSON.stringify([...updated]));
    set({ dismissedIds: updated });
  },

  isDismissed: (sectionId: string) => {
    return get().dismissedIds.has(sectionId);
  },

  clear: async () => {
    await AsyncStorage.removeItem(DISMISSALS_KEY);
    set({ dismissedIds: new Set() });
  },
}));

// Helper for synchronous access
export function getSectionDismissals(): Set<string> {
  return useSectionDismissals.getState().dismissedIds;
}

// Initialize dismissals (call during app startup)
export async function initializeSectionDismissals(): Promise<void> {
  await useSectionDismissals.getState().initialize();
}

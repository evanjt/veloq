import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'veloq-notification-preferences';

export interface NotificationPreferences {
  /** User has explicitly opted in to push notifications */
  enabled: boolean;
  /** User has accepted the privacy notice (required before enabling) */
  privacyAccepted: boolean;
  /** Per-category toggles */
  categories: {
    sectionPr: boolean;
    fitnessMilestone: boolean;
    periodComparison: boolean;
    activityPattern: boolean;
  };
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  privacyAccepted: false,
  categories: {
    sectionPr: true,
    fitnessMilestone: true,
    periodComparison: true,
    activityPattern: true,
  },
};

interface NotificationPreferencesState extends NotificationPreferences {
  isLoaded: boolean;
  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  acceptPrivacy: () => void;
  setCategoryEnabled: (
    category: keyof NotificationPreferences['categories'],
    enabled: boolean
  ) => void;
  reset: () => void;
}

function persist(state: NotificationPreferences): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useNotificationPreferences = create<NotificationPreferencesState>((set, get) => ({
  ...DEFAULT_PREFERENCES,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;
        set({
          enabled: parsed.enabled ?? false,
          privacyAccepted: parsed.privacyAccepted ?? false,
          categories: { ...DEFAULT_PREFERENCES.categories, ...parsed.categories },
          isLoaded: true,
        });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    set({ isLoaded: true });
  },

  setEnabled: (enabled: boolean) => {
    const state = get();
    const updated: NotificationPreferences = {
      enabled,
      privacyAccepted: state.privacyAccepted,
      categories: state.categories,
    };
    set({ enabled });
    persist(updated);
  },

  acceptPrivacy: () => {
    const state = get();
    const updated: NotificationPreferences = {
      enabled: state.enabled,
      privacyAccepted: true,
      categories: state.categories,
    };
    set({ privacyAccepted: true });
    persist(updated);
  },

  setCategoryEnabled: (category, enabled) => {
    const state = get();
    const categories = { ...state.categories, [category]: enabled };
    const updated: NotificationPreferences = {
      enabled: state.enabled,
      privacyAccepted: state.privacyAccepted,
      categories,
    };
    set({ categories });
    persist(updated);
  },

  reset: () => {
    set({ ...DEFAULT_PREFERENCES });
    persist(DEFAULT_PREFERENCES);
  },
}));

export function getNotificationPreferences(): NotificationPreferences {
  const state = useNotificationPreferences.getState();
  return {
    enabled: state.enabled,
    privacyAccepted: state.privacyAccepted,
    categories: state.categories,
  };
}

export async function initializeNotificationPreferences(): Promise<void> {
  await useNotificationPreferences.getState().initialize();
}

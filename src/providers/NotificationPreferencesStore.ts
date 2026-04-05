import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';

const STORAGE_KEY = 'veloq-notification-preferences';

export interface NotificationPreferences {
  /** User has explicitly opted in to push notifications */
  enabled: boolean;
  /** User has accepted the privacy notice (required before enabling) */
  privacyAccepted: boolean;
  /** Unregister request failed (e.g. offline) — retry on next app open */
  pendingUnregister: boolean;
  /** Per-category toggles */
  categories: {
    sectionPr: boolean;
    fitnessMilestone: boolean;
    periodComparison: boolean;
  };
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  privacyAccepted: false,
  pendingUnregister: false,
  categories: {
    sectionPr: true,
    fitnessMilestone: true,
    periodComparison: true,
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
  clearPendingUnregister: () => void;
  reset: () => void;
}

function persist(state: NotificationPreferences): void {
  setSetting(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useNotificationPreferences = create<NotificationPreferencesState>((set, get) => ({
  ...DEFAULT_PREFERENCES,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;
        set({
          enabled: parsed.enabled ?? false,
          privacyAccepted: parsed.privacyAccepted ?? false,
          pendingUnregister: parsed.pendingUnregister ?? false,
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
      pendingUnregister: enabled ? false : true,
      categories: state.categories,
    };
    set({ enabled, pendingUnregister: enabled ? false : true });
    persist(updated);

    // Register/unregister push token with server
    try {
      const { useAuthStore } = require('./AuthStore');
      const { athleteId } = useAuthStore.getState();
      if (athleteId) {
        if (enabled) {
          const { registerPushToken } = require('@/lib/notifications/pushTokenRegistration');
          registerPushToken(athleteId);
        } else {
          const { unregisterPushToken } = require('@/lib/notifications/pushTokenRegistration');
          unregisterPushToken(athleteId).then((success: boolean) => {
            if (success) {
              set({ pendingUnregister: false });
              persist({ ...get(), pendingUnregister: false });
            }
          });
        }
      }
    } catch {
      // Push token registration is best-effort
    }
  },

  acceptPrivacy: () => {
    const state = get();
    const updated: NotificationPreferences = {
      enabled: state.enabled,
      privacyAccepted: true,
      pendingUnregister: state.pendingUnregister,
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
      pendingUnregister: state.pendingUnregister,
      categories,
    };
    set({ categories });
    persist(updated);
  },

  clearPendingUnregister: () => {
    const state = get();
    set({ pendingUnregister: false });
    persist({ ...state, pendingUnregister: false });
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
    pendingUnregister: state.pendingUnregister,
    categories: state.categories,
  };
}

/** Retry a failed unregister request (called on app open) */
export async function retryPendingUnregister(athleteId: string): Promise<void> {
  const { unregisterPushToken } = require('@/lib/notifications/pushTokenRegistration');
  const success = await unregisterPushToken(athleteId);
  if (success) {
    useNotificationPreferences.getState().clearPendingUnregister();
  }
}

export async function initializeNotificationPreferences(): Promise<void> {
  await useNotificationPreferences.getState().initialize();
}

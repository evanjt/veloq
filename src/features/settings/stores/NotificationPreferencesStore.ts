import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';

const STORAGE_KEY = 'veloq-notification-preferences';

export interface NotificationPreferences {
  /** User has explicitly opted in to push notifications */
  enabled: boolean;
  /** User has accepted the privacy notice (required before enabling) */
  privacyAccepted: boolean;
  /** Unregister request failed (e.g. offline) - retry on next app open */
  pendingUnregister: boolean;
  /**
   * The athlete the pending unregister is for. Held here because a sign-out
   * deletes the credential the retry used to read, which left the token
   * registered for ever and the athlete still receiving pushes.
   */
  pendingUnregisterAthleteId: string | null;
  /** Per-category toggles */
  categories: {
    sectionPr: boolean;
    fitnessMilestone: boolean;
  };
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  privacyAccepted: false,
  pendingUnregister: false,
  pendingUnregisterAthleteId: null,
  categories: {
    sectionPr: true,
    fitnessMilestone: true,
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
          pendingUnregisterAthleteId: parsed.pendingUnregisterAthleteId ?? null,
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
    let athleteId: string | null = null;
    try {
      const { useAuthStore } = require('@/shared/app/AuthStore');
      athleteId = useAuthStore.getState().athleteId ?? null;
    } catch {
      // Push token registration is best-effort
    }

    const updated: NotificationPreferences = {
      enabled,
      privacyAccepted: state.privacyAccepted,
      pendingUnregister: !enabled,
      pendingUnregisterAthleteId: enabled ? null : athleteId,
      categories: state.categories,
    };
    set({
      enabled,
      pendingUnregister: updated.pendingUnregister,
      pendingUnregisterAthleteId: updated.pendingUnregisterAthleteId,
    });
    persist(updated);

    // Register/unregister push token with server
    if (!athleteId) return;
    try {
      if (enabled) {
        const { registerPushToken } = require('@/features/settings/lib/pushTokenRegistration');
        registerPushToken(athleteId);
      } else {
        const { unregisterPushToken } = require('@/features/settings/lib/pushTokenRegistration');
        unregisterPushToken(athleteId).then((success: boolean) => {
          if (success) get().clearPendingUnregister();
        });
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
      pendingUnregisterAthleteId: state.pendingUnregisterAthleteId,
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
      pendingUnregisterAthleteId: state.pendingUnregisterAthleteId,
      categories,
    };
    set({ categories });
    persist(updated);
  },

  clearPendingUnregister: () => {
    const state = get();
    set({ pendingUnregister: false, pendingUnregisterAthleteId: null });
    persist({ ...state, pendingUnregister: false, pendingUnregisterAthleteId: null });
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
    pendingUnregisterAthleteId: state.pendingUnregisterAthleteId,
    categories: state.categories,
  };
}

/**
 * The athlete a pending unregister should be retried for, or null when there
 * is nothing to retry. Prefers the id recorded with the request, since a
 * sign-out between the request and the retry deletes the signed-in one; falls
 * back to it for a request recorded before the id was persisted.
 */
export function resolvePendingUnregisterAthleteId(): string | null {
  const prefs = getNotificationPreferences();
  if (prefs.enabled || !prefs.pendingUnregister) return null;
  if (prefs.pendingUnregisterAthleteId) return prefs.pendingUnregisterAthleteId;
  try {
    const { useAuthStore } = require('@/shared/app/AuthStore');
    return useAuthStore.getState().athleteId ?? null;
  } catch {
    return null;
  }
}

/** Retry a failed unregister request (called on app open) */
export async function retryPendingUnregister(athleteId: string): Promise<void> {
  const { unregisterPushToken } = require('@/features/settings/lib/pushTokenRegistration');
  const success = await unregisterPushToken(athleteId);
  if (success) {
    useNotificationPreferences.getState().clearPendingUnregister();
  }
}

export async function initializeNotificationPreferences(): Promise<void> {
  await useNotificationPreferences.getState().initialize();
}

import { create } from 'zustand';
import { getSetting, setSetting, removeSetting } from '@/lib/backup';

const STORAGE_KEY = 'veloq-notification-prompt-dismissed';

interface NotificationPromptState {
  /** User dismissed the notification opt-in card */
  dismissed: boolean;
  /** Briefly shows "You can enable in Settings" after dismissal */
  showingSettingsHint: boolean;
  isLoaded: boolean;
  initialize: () => Promise<void>;
  dismiss: () => void;
  clearHint: () => void;
  reset: () => void;
}

export const useNotificationPrompt = create<NotificationPromptState>((set, get) => ({
  dismissed: false,
  showingSettingsHint: false,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored === 'true') {
        set({ dismissed: true, isLoaded: true });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    set({ isLoaded: true });
  },

  dismiss: () => {
    set({ dismissed: true, showingSettingsHint: true });
    setSetting(STORAGE_KEY, 'true').catch(() => {});
    // Auto-clear the hint after 4 seconds
    setTimeout(() => {
      if (get().showingSettingsHint) {
        set({ showingSettingsHint: false });
      }
    }, 4000);
  },

  clearHint: () => {
    set({ showingSettingsHint: false });
  },

  reset: () => {
    set({ dismissed: false, showingSettingsHint: false });
    removeSetting(STORAGE_KEY).catch(() => {});
  },
}));

export async function initializeNotificationPrompt(): Promise<void> {
  await useNotificationPrompt.getState().initialize();
}

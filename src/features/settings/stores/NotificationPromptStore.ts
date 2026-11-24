import { create } from 'zustand';
import { getSetting, setSetting, removeSetting } from '@/shared/storage';

const STORAGE_KEY = 'veloq-notification-prompt-dismissed';

interface NotificationPromptState {
  /** User dismissed the notification opt-in card */
  dismissed: boolean;
  isLoaded: boolean;
  initialise: () => Promise<void>;
  dismiss: () => void;
  reset: () => void;
}

export const useNotificationPrompt = create<NotificationPromptState>((set) => ({
  dismissed: false,
  isLoaded: false,

  initialise: async () => {
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
    set({ dismissed: true });
    setSetting(STORAGE_KEY, 'true').catch(() => {});
  },

  reset: () => {
    set({ dismissed: false });
    removeSetting(STORAGE_KEY).catch(() => {});
  },
}));

export async function initialiseNotificationPrompt(): Promise<void> {
  await useNotificationPrompt.getState().initialise();
}

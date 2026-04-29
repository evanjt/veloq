import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';

const STORAGE_KEY = 'veloq-support-store';

interface SupportState {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  isLoaded: boolean;
  shouldShow: () => boolean;
  remindLater: () => void;
  neverShowAgain: () => void;
  recordAction: () => void;
  setLegacyPurchaser: () => void;
  initialize: () => Promise<void>;
}

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60 * 24);
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

interface PersistedData {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
}

function persist(state: SupportState): void {
  const data: PersistedData = {
    lastActionDate: state.lastActionDate,
    permanentlyDismissed: state.permanentlyDismissed,
    isLegacyPurchaser: state.isLegacyPurchaser,
  };
  setSetting(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
}

export const useSupportStore = create<SupportState>((set, get) => ({
  lastActionDate: null,
  permanentlyDismissed: false,
  isLegacyPurchaser: false,
  isLoaded: false,

  shouldShow: () => {
    const s = get();
    if (!s.isLoaded) return false;
    if (s.permanentlyDismissed) return false;
    if (s.lastActionDate === null) {
      // First launch — seed the 30-day timer but don't show
      set((prev) => {
        const next = { ...prev, lastActionDate: todayISO() };
        persist(next as SupportState);
        return next;
      });
      return false;
    }
    return daysSince(s.lastActionDate) >= 30;
  },

  remindLater: () => {
    set((s) => {
      const next = { ...s, lastActionDate: todayISO() };
      persist(next as SupportState);
      return next;
    });
  },

  neverShowAgain: () => {
    set((s) => {
      const next = { ...s, permanentlyDismissed: true, lastActionDate: todayISO() };
      persist(next as SupportState);
      return next;
    });
  },

  recordAction: () => {
    set((s) => {
      const next = { ...s, lastActionDate: todayISO() };
      persist(next as SupportState);
      return next;
    });
  },

  setLegacyPurchaser: () => {
    set((s) => {
      const next = { ...s, isLegacyPurchaser: true };
      persist(next as SupportState);
      return next;
    });
  },

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const data: PersistedData = JSON.parse(stored);
        set({
          lastActionDate: data.lastActionDate ?? null,
          permanentlyDismissed: data.permanentlyDismissed ?? false,
          isLegacyPurchaser: data.isLegacyPurchaser ?? false,
          isLoaded: true,
        });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    set({ isLoaded: true });
  },
}));

export async function initializeSupportStore(): Promise<void> {
  await useSupportStore.getState().initialize();
}

import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';
import { formatLocalDate } from '@/lib/utils/format';

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
  _debugOverride: (partial: Partial<PersistedData>) => void;
  initialize: () => Promise<void>;
}

export function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60 * 24);
}

interface PersistedData {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
}

function persist(
  state: Pick<SupportState, 'lastActionDate' | 'permanentlyDismissed' | 'isLegacyPurchaser'>
): void {
  const data: PersistedData = {
    lastActionDate: state.lastActionDate,
    permanentlyDismissed: state.permanentlyDismissed,
    isLegacyPurchaser: state.isLegacyPurchaser,
  };
  setSetting(STORAGE_KEY, JSON.stringify(data)).catch((e) => {
    if (__DEV__) console.warn('[SupportStore] persist failed:', e);
  });
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
    if (s.lastActionDate === null) return false;
    return daysSince(s.lastActionDate) >= 30;
  },

  remindLater: () => {
    set((s) => {
      const next = { ...s, lastActionDate: formatLocalDate(new Date()) };
      persist(next);
      return next;
    });
  },

  neverShowAgain: () => {
    set((s) => {
      const next = {
        ...s,
        permanentlyDismissed: true,
        lastActionDate: formatLocalDate(new Date()),
      };
      persist(next);
      return next;
    });
  },

  recordAction: () => {
    set((s) => {
      const next = { ...s, lastActionDate: formatLocalDate(new Date()) };
      persist(next);
      return next;
    });
  },

  setLegacyPurchaser: () => {
    set((s) => {
      const next = { ...s, isLegacyPurchaser: true };
      persist(next);
      return next;
    });
  },

  _debugOverride: (partial: Partial<PersistedData>) => {
    set((s) => {
      const next = { ...s, ...partial };
      persist(next);
      return next;
    });
  },

  initialize: async () => {
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) {
        const data: PersistedData = JSON.parse(stored);
        const lastActionDate = data.lastActionDate ?? null;
        if (lastActionDate === null) {
          const seeded = formatLocalDate(new Date());
          set({
            lastActionDate: seeded,
            permanentlyDismissed: data.permanentlyDismissed ?? false,
            isLegacyPurchaser: data.isLegacyPurchaser ?? false,
            isLoaded: true,
          });
          persist({
            lastActionDate: seeded,
            permanentlyDismissed: data.permanentlyDismissed ?? false,
            isLegacyPurchaser: data.isLegacyPurchaser ?? false,
          });
          return;
        }
        set({
          lastActionDate,
          permanentlyDismissed: data.permanentlyDismissed ?? false,
          isLegacyPurchaser: data.isLegacyPurchaser ?? false,
          isLoaded: true,
        });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    const seeded = formatLocalDate(new Date());
    set({ lastActionDate: seeded, isLoaded: true });
    persist({ lastActionDate: seeded, permanentlyDismissed: false, isLegacyPurchaser: false });
  },
}));

export async function initializeSupportStore(): Promise<void> {
  await useSupportStore.getState().initialize();
}

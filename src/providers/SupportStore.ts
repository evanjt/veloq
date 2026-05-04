import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/backup';
import { formatLocalDate } from '@/lib/utils/format';

const STORAGE_KEY = 'veloq-support-store';

interface SupportState {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount: number;
  isLoaded: boolean;
  shouldShow: () => boolean;
  getIntervalDays: () => number;
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

function intervalForCount(count: number): number {
  if (count === 0) return 7;
  if (count === 1) return 30;
  return 90;
}

interface PersistedData {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount?: number;
}

function persist(
  state: Pick<
    SupportState,
    'lastActionDate' | 'permanentlyDismissed' | 'isLegacyPurchaser' | 'dismissCount'
  >
): void {
  const data: PersistedData = {
    lastActionDate: state.lastActionDate,
    permanentlyDismissed: state.permanentlyDismissed,
    isLegacyPurchaser: state.isLegacyPurchaser,
    dismissCount: state.dismissCount,
  };
  setSetting(STORAGE_KEY, JSON.stringify(data)).catch((e) => {
    if (__DEV__) console.warn('[SupportStore] persist failed:', e);
  });
}

export const useSupportStore = create<SupportState>((set, get) => ({
  lastActionDate: null,
  permanentlyDismissed: false,
  isLegacyPurchaser: false,
  dismissCount: 0,
  isLoaded: false,

  getIntervalDays: () => {
    const s = get();
    return intervalForCount(s.dismissCount);
  },

  shouldShow: () => {
    const s = get();
    if (!s.isLoaded) return false;
    if (s.permanentlyDismissed) return false;
    if (s.isLegacyPurchaser) return false;
    if (s.lastActionDate === null) return false;
    return daysSince(s.lastActionDate) >= intervalForCount(s.dismissCount);
  },

  remindLater: () => {
    set((s) => {
      const next = {
        ...s,
        lastActionDate: formatLocalDate(new Date()),
        dismissCount: s.dismissCount + 1,
      };
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
      const next = { ...s, lastActionDate: formatLocalDate(new Date()), dismissCount: 0 };
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
            dismissCount: data.dismissCount ?? 0,
            isLoaded: true,
          });
          persist({
            lastActionDate: seeded,
            permanentlyDismissed: data.permanentlyDismissed ?? false,
            isLegacyPurchaser: data.isLegacyPurchaser ?? false,
            dismissCount: data.dismissCount ?? 0,
          });
          return;
        }
        set({
          lastActionDate,
          permanentlyDismissed: data.permanentlyDismissed ?? false,
          isLegacyPurchaser: data.isLegacyPurchaser ?? false,
          dismissCount: data.dismissCount ?? 0,
          isLoaded: true,
        });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    const seeded = formatLocalDate(new Date());
    set({ lastActionDate: seeded, dismissCount: 0, isLoaded: true });
    persist({
      lastActionDate: seeded,
      permanentlyDismissed: false,
      isLegacyPurchaser: false,
      dismissCount: 0,
    });
  },
}));

export async function initializeSupportStore(): Promise<void> {
  await useSupportStore.getState().initialize();
}

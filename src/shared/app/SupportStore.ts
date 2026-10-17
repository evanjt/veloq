import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { formatLocalDate } from '@/shared/format/format';
import { TIME } from './time';

const STORAGE_KEY = 'veloq-support-store';

interface SupportState {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount: number;
  firstUseDate: string | null;
  lastUseDate: string | null;
  useDays: number;
  isLoaded: boolean;
  shouldShow: () => boolean;
  getIntervalDays: () => number;
  remindLater: () => void;
  neverShowAgain: () => void;
  recordAction: () => void;
  _debugOverride: (partial: Partial<PersistedData>) => void;
  initialise: () => Promise<void>;
}

export function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return (now - then) / TIME.DAY;
}

function intervalForCount(count: number): number {
  if (count === 0) return 7;
  if (count === 1) return 30;
  return 90;
}

/** Distinct local days of use before a never-dismissed card first shows. */
export const FIRST_SHOW_USE_DAYS = 5;
/** Days since the first use before a never-dismissed card first shows. */
export const FIRST_SHOW_MIN_DAYS = 14;

interface PersistedData {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount?: number;
  firstUseDate?: string | null;
  lastUseDate?: string | null;
  useDays?: number;
}

type PersistedFields =
  | 'lastActionDate'
  | 'permanentlyDismissed'
  | 'isLegacyPurchaser'
  | 'dismissCount'
  | 'firstUseDate'
  | 'lastUseDate'
  | 'useDays';

function persist(state: Pick<SupportState, PersistedFields>): void {
  const data: PersistedData = {
    lastActionDate: state.lastActionDate,
    permanentlyDismissed: state.permanentlyDismissed,
    isLegacyPurchaser: state.isLegacyPurchaser,
    dismissCount: state.dismissCount,
    firstUseDate: state.firstUseDate,
    lastUseDate: state.lastUseDate,
    useDays: state.useDays,
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
  firstUseDate: null,
  lastUseDate: null,
  useDays: 0,
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
    if (s.dismissCount === 0) {
      if (s.firstUseDate === null) return false;
      if (s.useDays < FIRST_SHOW_USE_DAYS) return false;
      if (daysSince(s.firstUseDate) < FIRST_SHOW_MIN_DAYS) return false;
    }
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

  _debugOverride: (partial: Partial<PersistedData>) => {
    set((s) => {
      const next = { ...s, ...partial };
      persist(next);
      return next;
    });
  },

  initialise: async () => {
    const today = formatLocalDate(new Date());
    let data: PersistedData | null = null;
    try {
      const stored = await getSetting(STORAGE_KEY);
      if (stored) data = JSON.parse(stored);
    } catch {
      // Ignore parse errors
    }
    // A row stored before the use count existed starts its count from today,
    // so no installed athlete sees the card sooner than a new install would.
    const firstUseDate = data?.firstUseDate ?? today;
    const priorUseDays = data?.firstUseDate ? (data.useDays ?? 0) : 0;
    const lastUseDate = data?.firstUseDate ? (data.lastUseDate ?? null) : null;
    const next = {
      lastActionDate: data?.lastActionDate ?? today,
      permanentlyDismissed: data?.permanentlyDismissed ?? false,
      isLegacyPurchaser: data?.isLegacyPurchaser ?? false,
      dismissCount: data?.dismissCount ?? 0,
      firstUseDate,
      lastUseDate: today,
      useDays: lastUseDate === today ? priorUseDays : priorUseDays + 1,
    };
    set({ ...next, isLoaded: true });
    const changed =
      data === null ||
      data.lastActionDate !== next.lastActionDate ||
      data.firstUseDate !== next.firstUseDate ||
      data.lastUseDate !== next.lastUseDate ||
      data.useDays !== next.useDays;
    if (changed) persist(next);
  },
}));

export async function initialiseSupportStore(): Promise<void> {
  await useSupportStore.getState().initialise();
}

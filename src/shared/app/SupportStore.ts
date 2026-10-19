import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { calendarDaysBetween, formatLocalDate } from '@/shared/format/format';

const STORAGE_KEY = 'veloq-support-store';

interface SupportState {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount: number;
  isLoaded: boolean;
  /** Whether the card is due, given the install's days of use. */
  shouldShow: (usage: DaysOfUse) => boolean;
  getIntervalDays: () => number;
  remindLater: () => void;
  neverShowAgain: () => void;
  recordAction: () => void;
  _debugOverride: (partial: Partial<PersistedData>) => void;
  initialise: () => Promise<void>;
}

/**
 * Whole local calendar days from a stored `YYYY-MM-DD` day to today. The day is
 * read on the device's calendar, as it was written, since a date-only string
 * parses as UTC midnight and would move the count by a day east or west of UTC.
 */
export function daysSince(localDate: string): number {
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  return calendarDaysBetween(new Date(year, month - 1, day), new Date());
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

/** The install's days of use, counted with the launch asks' record. */
export interface DaysOfUse {
  firstUseDate: string | null;
  useDays: number;
}

interface PersistedData {
  lastActionDate: string | null;
  permanentlyDismissed: boolean;
  isLegacyPurchaser: boolean;
  dismissCount?: number;
}

type PersistedFields =
  'lastActionDate' | 'permanentlyDismissed' | 'isLegacyPurchaser' | 'dismissCount';

function persist(state: Pick<SupportState, PersistedFields>): void {
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

  shouldShow: (usage) => {
    const s = get();
    if (!s.isLoaded) return false;
    if (s.permanentlyDismissed) return false;
    if (s.isLegacyPurchaser) return false;
    if (s.lastActionDate === null) return false;
    if (s.dismissCount === 0) {
      if (usage.firstUseDate === null) return false;
      if (usage.useDays < FIRST_SHOW_USE_DAYS) return false;
      if (daysSince(usage.firstUseDate) < FIRST_SHOW_MIN_DAYS) return false;
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
    const next = {
      lastActionDate: data?.lastActionDate ?? today,
      permanentlyDismissed: data?.permanentlyDismissed ?? false,
      isLegacyPurchaser: data?.isLegacyPurchaser ?? false,
      dismissCount: data?.dismissCount ?? 0,
    };
    set({ ...next, isLoaded: true });
    // Only a new row is written here. An older one still carries the day count the
    // usage record is first read from, and an answer on the card rewrites it later.
    if (data === null) persist(next);
  },
}));

export async function initialiseSupportStore(): Promise<void> {
  await useSupportStore.getState().initialise();
}

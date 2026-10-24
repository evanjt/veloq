/**
 * What the athlete has done with this install: the distinct local days they
 * opened it on, and whether a sync has ever finished clean on it.
 *
 * The launch asks wait on both before anything but a restore offer shows, and
 * the support card waits on the day count, so both read the one record. It is
 * this install's bookkeeping, so a backup does not carry it and a restore
 * leaves it as it was.
 */
import { getSetting, setSetting } from '@/shared/storage';

export const USAGE_KEY = 'veloq-usage';
/** Where the day count was kept before it had a row of its own. */
const LEGACY_SUPPORT_KEY = 'veloq-support-store';

export interface UseDays {
  /** The local day of the first use, or null before any is counted. */
  firstUseDate: string | null;
  /** The local day of the latest use. */
  lastUseDate: string | null;
  /** Distinct local days of use, today included. */
  useDays: number;
}

export interface Usage extends UseDays {
  /** Launches of this install, counted once per process and across days. */
  launches: number;
  /** A sync has finished clean on this install. */
  firstSyncSettled: boolean;
}

const NO_USE: UseDays = { firstUseDate: null, lastUseDate: null, useDays: 0 };

/** The count after a use on `today`: a second use on the same local day adds nothing. */
export function countUseDay(prior: UseDays, today: string): UseDays {
  if (prior.firstUseDate === null) {
    return { firstUseDate: today, lastUseDate: today, useDays: 1 };
  }
  return {
    firstUseDate: prior.firstUseDate,
    lastUseDate: today,
    useDays: prior.lastUseDate === today ? prior.useDays : prior.useDays + 1,
  };
}

async function readJson<T>(key: string): Promise<Partial<T> | null> {
  try {
    const stored = await getSetting(key);
    return stored ? (JSON.parse(stored) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function daysOf(row: Partial<UseDays> | null): UseDays {
  if (!row?.firstUseDate) return NO_USE;
  return {
    firstUseDate: row.firstUseDate,
    lastUseDate: row.lastUseDate ?? null,
    useDays: row.useDays ?? 0,
  };
}

/**
 * The stored record, or null when there is none. An install with no record
 * of its own takes the count the support card's row kept before this one
 * existed. A support row stored before the count existed at all has no first
 * use and starts from today, so no installed athlete is counted as having
 * used the app longer than they have.
 */
export async function readUsage(): Promise<{ stored: Partial<Usage> | null; prior: Usage }> {
  const stored = await readJson<Usage>(USAGE_KEY);
  const days = daysOf(stored ?? (await readJson<UseDays>(LEGACY_SUPPORT_KEY)));
  // A record from before launches were counted holds at least one launch per day of use.
  const launches = stored?.launches ?? days.useDays;
  return {
    stored,
    prior: { ...days, launches, firstSyncSettled: stored?.firstSyncSettled === true },
  };
}

export function sameUsage(a: Partial<Usage> | null, b: Usage): boolean {
  return (
    a !== null &&
    a.firstUseDate === b.firstUseDate &&
    a.lastUseDate === b.lastUseDate &&
    a.useDays === b.useDays &&
    a.launches === b.launches &&
    a.firstSyncSettled === b.firstSyncSettled
  );
}

export function persistUsage(usage: Usage): void {
  const row: Usage = {
    firstUseDate: usage.firstUseDate,
    lastUseDate: usage.lastUseDate,
    useDays: usage.useDays,
    launches: usage.launches,
    firstSyncSettled: usage.firstSyncSettled,
  };
  setSetting(USAGE_KEY, JSON.stringify(row)).catch((e) => {
    if (__DEV__) console.warn('[usage] persist failed:', e);
  });
}

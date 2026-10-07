/**
 * What the record entry screen offers before a ride: the sport Start begins,
 * the chips beside it, and the route a Start takes.
 *
 * The screen is the recording, before it begins. One Start labelled with the sport, the
 * recent sports as chips and the full list behind More, so the choice never
 * owns the screen.
 */
import type { ActivityType } from '@/types';

import { ENTRY_SCREEN_ENTRY } from './armCountdown';

/** The sports offered before the athlete has recorded anything. */
export const DEFAULT_ENTRY_SPORTS: readonly ActivityType[] = ['Ride', 'Run', 'Walk', 'Hike'];

/** Chips shown beside More. Enough to hold a week's habits on a narrow phone. */
export const ENTRY_CHIP_COUNT = 4;

/** A fix this tight or tighter reads as ready. */
export const GPS_READY_ACCURACY_M = 20;

/** The sport Start begins on arrival: the last one recorded. */
export function defaultEntrySport(recent: readonly ActivityType[]): ActivityType {
  return recent[0] ?? DEFAULT_ENTRY_SPORTS[0];
}

/**
 * The chip row. The recent sports, most recent first, and the chosen sport
 * always among them, so a pick from More is shown as the one Start begins.
 */
export function entrySportChips(
  recent: readonly ActivityType[],
  chosen: ActivityType,
  count: number = ENTRY_CHIP_COUNT
): ActivityType[] {
  const base = (recent.length > 0 ? recent : DEFAULT_ENTRY_SPORTS).slice(0, count);
  if (base.includes(chosen)) return base;
  return [chosen, ...base.slice(0, count - 1)];
}

/** The route a Start takes: the recording screen, which begins on arrival. */
export function recordingEntryHref(type: ActivityType, pairedEventId?: number): string {
  const paired = pairedEventId != null ? `&pairedEventId=${pairedEventId}` : '';
  return `/recording/${type}?from=${ENTRY_SCREEN_ENTRY}${paired}`;
}

export type EntryGpsState = 'checking' | 'ready' | 'weak' | 'none';

/** What a fix says about readiness. A fix with no accuracy is not a ready one. */
export function entryGpsState(accuracy: number | null | undefined): EntryGpsState {
  return accuracy != null && accuracy <= GPS_READY_ACCURACY_M ? 'ready' : 'weak';
}

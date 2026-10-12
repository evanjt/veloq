/**
 * What the record entry screen offers before a ride: the sport Start begins,
 * the chips beside it, and the route a Start takes.
 *
 * The screen is the recording, before it begins. One Start labelled with the sport, the
 * recent sports as chips and the full list behind More, so the choice never
 * owns the screen.
 */
import type { ActivityType } from '@/types';
import type { LocationPrecision } from '@/shared/app/permissions/locationGrant';

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

/**
 * `servicesOff` is the device's own location switch, apart from the app's
 * permission: Android grants the permission with the switch off and sends no
 * fix, and iOS reports the permission denied.
 */
export type EntryGpsState = 'checking' | 'ready' | 'weak' | 'approximate' | 'none' | 'servicesOff';

/**
 * What a fix says about readiness. A fix with no accuracy is not a ready one.
 * An approximate grant is its own state whatever the fix: its fixes are too
 * coarse for the recording to keep, and the cause is the setting, not the sky.
 */
export function entryGpsState(
  accuracy: number | null | undefined,
  precision: LocationPrecision = 'precise'
): EntryGpsState {
  if (precision === 'approximate') return 'approximate';
  return accuracy != null && accuracy <= GPS_READY_ACCURACY_M ? 'ready' : 'weak';
}

/** What the entry screen knows about location before a ride. */
export interface EntryGpsInput {
  /** The device's location switch, null until it has been read. */
  servicesEnabled: boolean | null;
  permission: 'unknown' | 'granted' | 'denied';
  /** The latest fix, null before the first. */
  fix: { accuracy: number | null } | null;
  /** The first fix has taken longer than the screen waits for one. */
  timedOut: boolean;
  /** How precise the granted location is; precise until the grant is read. */
  precision: LocationPrecision;
}

/**
 * The GPS state the entry screen shows. The switch comes first: with it off no
 * fix will come and a permission reads as denied, so naming either would send
 * the athlete to the wrong place.
 */
export function resolveEntryGps({
  servicesEnabled,
  permission,
  fix,
  timedOut,
  precision,
}: EntryGpsInput): EntryGpsState {
  if (servicesEnabled === false) return 'servicesOff';
  if (permission === 'denied') return 'none';
  if (fix) return entryGpsState(fix.accuracy, precision);
  // An approximate grant is known before any fix, so it does not wait out the timeout.
  if (timedOut || precision === 'approximate') return entryGpsState(null, precision);
  return 'checking';
}

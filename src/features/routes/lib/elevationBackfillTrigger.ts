/**
 * Launch and resume trigger for the elevation backfill.
 *
 * Stored tracks written before elevation was part of the track stream carry no
 * per-point altitude, so an update has to re-fetch them once. The trigger
 * attempts a run on every launch until Rust reports nothing left to ask, then
 * stamps the app version so later launches skip the engine calls entirely. A
 * pass that ends partial, a missing credential or a thrown FFI error therefore
 * costs one launch, not the whole app version.
 *
 * The launch is not the only chance. A process that stays alive would
 * otherwise wait for the user to kill and reopen the app, and the detector
 * cutover waits behind the queue, so returning to the foreground attempts a
 * run too. Those attempts are spaced on a growing ladder, capped, so a
 * connection that is really down is asked a handful of times over an evening
 * rather than at every glance at the phone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { getRouteEngine } from '@/shared/native/routeEngine';

const VERSION_KEY = 'veloq-elevation-backfill-version';

/**
 * How long a foreground attempt waits after the one before it, longest last.
 * The last entry is the resting rate: a library nothing can elevate is asked
 * about twice an hour, not once a minute.
 */
const RESUME_WAITS_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000];

/** In-process guard so the engine retry ladder cannot fire two runs at once. */
let inFlight: Promise<boolean> | null = null;

/** How many attempts this process has made, which is its place on the ladder. */
let attempts = 0;

/** The earliest a foreground attempt may run. Armed by every attempt. */
let nextAttemptAt = 0;

function armNextAttempt(): void {
  nextAttemptAt = Date.now() + RESUME_WAITS_MS[Math.min(attempts, RESUME_WAITS_MS.length - 1)];
  attempts += 1;
}

function currentAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function attempt(): Promise<boolean> {
  const version = currentAppVersion();
  if (!version) return false;

  const seen = await AsyncStorage.getItem(VERSION_KEY);
  if (seen === version) return false;

  const engine = getRouteEngine();
  if (!engine) return false;

  try {
    // Null means the engine could not answer, which is not the same as zero.
    if (engine.getElevationBackfillRemaining() === 0) {
      // The library has been fully asked. Stamp only on this definitive
      // answer: a refusal to start (no credential yet, a run in flight) or a
      // partial pass leaves the marker unset so the next launch tries again.
      await AsyncStorage.setItem(VERSION_KEY, version);
      return false;
    }
    return engine.startElevationBackfill();
  } catch {
    return false;
  }
}

/**
 * Start the backfill if tracks still lack elevation and this app version has
 * not already finished the job. Resolves to whether Rust accepted the run.
 */
export function startElevationBackfillAfterUpdate(): Promise<boolean> {
  if (inFlight) return inFlight;
  armNextAttempt();
  inFlight = attempt().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Attempt a run on returning to the foreground, if this process has waited
 * long enough since its last attempt. Resolves to whether Rust accepted a run.
 *
 * Cheap to call on every foreground: before the wait elapses it touches
 * neither AsyncStorage nor the engine.
 */
export function resumeElevationBackfill(): Promise<boolean> {
  if (Date.now() < nextAttemptAt) return Promise.resolve(false);
  return startElevationBackfillAfterUpdate();
}

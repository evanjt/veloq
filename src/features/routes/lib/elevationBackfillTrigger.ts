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
 * The launch is not the only chance, but the others are not this module's.
 * Rust arms its own ladder behind every accepted start and climbs it against
 * its own connectivity state, so a pass left partial is asked again without
 * the app being killed and reopened, and without a foreground to ride in on.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { StartOutcome } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';

/** The app version whose backfill finished on this device. */
export const ELEVATION_BACKFILL_STAMP_KEY = 'veloq-elevation-backfill-version';
const VERSION_KEY = ELEVATION_BACKFILL_STAMP_KEY;

/**
 * In-process guard against the two launch effects racing. It covers this
 * module's own async work, the version read; the run itself is guarded in
 * Rust, which refuses a second pass while one holds the slot.
 */
let inFlight: Promise<StartOutcome> | null = null;

function currentAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function attempt(): Promise<StartOutcome> {
  const version = currentAppVersion();
  if (!version) return StartOutcome.NotReady;

  const seen = await AsyncStorage.getItem(VERSION_KEY);
  if (seen === version) return StartOutcome.NotOwed;

  const engine = getEngine();
  if (!engine) return StartOutcome.NotReady;

  try {
    // Null means the engine could not answer, which is not the same as zero.
    if (engine.getElevationBackfillRemaining() === 0) {
      // The library has been fully asked. Stamp only on this definitive
      // answer: a refusal to start (no credential yet, a run in flight) or a
      // partial pass leaves the marker unset so the next launch tries again.
      await AsyncStorage.setItem(VERSION_KEY, version);
      return StartOutcome.NotOwed;
    }
    const outcome = engine.startElevationBackfill();
    // The count above is read before the start, so a pass that drained the
    // last of the queue leaves it stale by one launch. The start's own
    // `NotOwed` is the fresher answer and stamps on the same terms: it is the
    // job finished, not a refusal that lifts.
    if (outcome === StartOutcome.NotOwed) {
      await AsyncStorage.setItem(VERSION_KEY, version);
    }
    return outcome;
  } catch {
    return StartOutcome.Failed;
  }
}

/**
 * Start the backfill if tracks still lack elevation and this app version has
 * not already finished the job. Resolves to Rust's verdict on the run, so a
 * caller can tell the job finishing from a refusal worth asking about again.
 */
export function startElevationBackfillAfterUpdate(): Promise<StartOutcome> {
  if (inFlight) return inFlight;
  inFlight = attempt().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

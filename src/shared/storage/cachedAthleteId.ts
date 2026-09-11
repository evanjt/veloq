/**
 * AsyncStorage mirror of the engine's `__athlete_id` setting.
 *
 * The engine only initialises inside the authenticated branch, so on a
 * cold start at the login screen it is null and every SQLite read returns
 * empty. That makes an engine-only identity check answer "no cached data"
 * for a device that is full of it. The mirror survives the engine being
 * down, so the destructive paths can still tell whose data is on disk.
 *
 * Written whenever the engine writes `__athlete_id`, removed by
 * `clearAccountData`, which is the only thing that wipes the engine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHED_ATHLETE_ID_KEY = 'cached_athlete_id';

export async function rememberCachedAthleteId(athleteId: string): Promise<void> {
  if (!athleteId) return;
  try {
    await AsyncStorage.setItem(CACHED_ATHLETE_ID_KEY, athleteId);
  } catch {
    // Mirror is best-effort - the engine setting stays authoritative
  }
}

export async function forgetCachedAthleteId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHED_ATHLETE_ID_KEY);
  } catch {
    // Best-effort, as above
  }
}

export async function readCachedAthleteIdMirror(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CACHED_ATHLETE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * How many activities the library on disk holds, mirrored the same way and for
 * the same reason as the id above.
 *
 * `getActivityCount()` on a closed engine answers 0, which is also the honest
 * answer for an empty device, so a destructive path at the login screen could
 * not tell a restored library from no library at all. The mirror is written
 * where the count is known and the engine is open, and read where it is not.
 */
const STORED_ACTIVITY_COUNT_KEY = 'stored_activity_count';

export async function rememberStoredActivityCount(count: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORED_ACTIVITY_COUNT_KEY, String(count));
  } catch {
    // Best-effort, as above
  }
}

export async function forgetStoredActivityCount(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORED_ACTIVITY_COUNT_KEY);
  } catch {
    // Best-effort, as above
  }
}

/** Zero for a device with no mirror, which is what an empty library reads as. */
export async function readStoredActivityCountMirror(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORED_ACTIVITY_COUNT_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

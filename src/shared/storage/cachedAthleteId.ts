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

/**
 * Which session the credentials in the keychain make.
 *
 * Pure, so launch and the tests read one rule. An intervals.icu credential
 * decides first, and a Garmin key beside it changes nothing: the key is a
 * second connector on that account. A Garmin key is a session of its own only
 * when it is held with the library identity a Garmin-only sign-in wrote and no
 * intervals.icu credential exists. A key alone is what an intervals.icu
 * sign-out leaves behind, and it signs nobody in.
 */

import type { AuthMethod } from '@/shared/app/source';

/** What names a library that belongs to a Garmin account rather than an intervals.icu athlete. */
const GARMIN_ATHLETE_PREFIX = 'garmin:';

/** The library identity for the account Garmin keeps under `accountId`. */
export function garminAthleteId(accountId: string): string {
  return `${GARMIN_ATHLETE_PREFIX}${accountId.trim()}`;
}

/** Whether `athleteId` is a library identity a Garmin-only sign-in wrote. */
export function isGarminAthleteId(athleteId: string | null | undefined): boolean {
  return (
    typeof athleteId === 'string' &&
    athleteId.startsWith(GARMIN_ATHLETE_PREFIX) &&
    athleteId.slice(GARMIN_ATHLETE_PREFIX.length).trim().length > 0
  );
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export interface StoredCredentials {
  apiKey: string | null;
  accessToken: string | null;
  athleteId: string | null;
  garminKey: string | null;
}

export interface StoredSession {
  authMethod: Exclude<AuthMethod, 'demo'> | null;
  isAuthenticated: boolean;
}

/** OAuth first, then an API key, then a Garmin key alone. */
export function resolveStoredSession(stored: StoredCredentials): StoredSession {
  if (present(stored.athleteId)) {
    if (present(stored.accessToken)) return { authMethod: 'oauth', isAuthenticated: true };
    if (present(stored.apiKey)) return { authMethod: 'apiKey', isAuthenticated: true };
    if (present(stored.garminKey) && isGarminAthleteId(stored.athleteId.trim())) {
      return { authMethod: 'garmin', isAuthenticated: true };
    }
  }
  return { authMethod: null, isAuthenticated: false };
}

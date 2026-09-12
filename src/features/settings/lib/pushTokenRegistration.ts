import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/shared/debug/debug';
import { getStoredCredentials } from '@/shared/app/AuthStore';

const log = debug.create('PushToken');

/** Base URL for the API worker */
const API_URL = 'https://auth.veloq.fit';

/** Last successful registration refresh (ms epoch). Internal bookkeeping, not a user setting. */
const TOKEN_REFRESHED_AT_KEY = 'veloq-push-token-refreshed-at';

/** The token the server was last told about, for the same bookkeeping. */
const TOKEN_REGISTERED_KEY = 'veloq-push-token-registered';

/**
 * Server-side tokens expire after 30 days and are otherwise only re-registered
 * on app open, login, or opt-in. Refresh at most daily from the paths that
 * prove the pipeline is alive (app foreground, silent-push task) so a user who
 * rarely opens the app does not silently fall off the notification list.
 */
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Re-register the push token if the last successful registration is older
 * than a day. Safe to call from background (headless) contexts. Callers are
 * responsible for checking that notifications are enabled.
 */
export async function refreshPushTokenRegistration(athleteId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_REFRESHED_AT_KEY);
    const last = raw ? Number(raw) : 0;
    if (Number.isFinite(last) && Date.now() - last < TOKEN_REFRESH_INTERVAL_MS) {
      return;
    }
    await registerPushToken(athleteId);
  } catch (e) {
    log.warn('Push token refresh failed:', e);
  }
}

/**
 * Register on app open, but only when there is something to say.
 *
 * Every launch used to POST the same token, so a user who opens the app ten
 * times a day made ten registrations of a record with a 30-day life. A token
 * the server has not seen goes up at once, because that is the one case where
 * waiting for the daily refresh loses notifications; anything else falls
 * through to the refresh and its throttle.
 */
export async function ensurePushTokenRegistered(athleteId: string): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token) return;
    const registered = await AsyncStorage.getItem(TOKEN_REGISTERED_KEY);
    if (registered === token) {
      await refreshPushTokenRegistration(athleteId);
      return;
    }
    await registerPushToken(athleteId);
  } catch (e) {
    log.warn('Push token registration check failed:', e);
  }
}

/**
 * The intervals.icu credential this device holds, in the form intervals.icu
 * itself reads.
 *
 * The worker forwards it to `GET /athlete/0` and refuses a registration whose
 * athlete id is not the one that comes back, so a device speaks only for the
 * athlete it is signed in as. Both sign-ins carry: OAuth as a bearer, a
 * personal API key as Basic `API_KEY:<key>`.
 */
export function authorizationHeader(
  credentials: Pick<
    ReturnType<typeof getStoredCredentials>,
    'apiKey' | 'accessToken' | 'authMethod'
  >
): string | null {
  const { apiKey, accessToken, authMethod } = credentials;
  if (authMethod === 'oauth' && accessToken?.trim()) {
    return `Bearer ${accessToken.trim()}`;
  }
  if (authMethod === 'apiKey' && apiKey?.trim()) {
    return `Basic ${base64(`API_KEY:${apiKey.trim()}`)}`;
  }
  return null;
}

/** Hermes has no `btoa`, and this runs in the headless task too. */
function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/**
 * Get the Expo push token for this device.
 * Expo handles FCM (Android) and APNs (iOS) routing transparently.
 * Returns null if unable to get token.
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    });
    return token.data;
  } catch (e) {
    log.error('Failed to get Expo push token:', e);
    return null;
  }
}

/**
 * Register the Expo push token with auth.veloq.fit.
 * Only call after user has explicitly opted in.
 */
export async function registerPushToken(athleteId: string): Promise<boolean> {
  const token = await getExpoPushToken();
  if (!token) return false;

  const authorization = authorizationHeader(getStoredCredentials());
  if (!authorization) {
    log.warn('No credential to register a push token with');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({
        athleteId,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });

    if (response.ok) {
      log.log('Push token registered');
      await AsyncStorage.multiSet([
        [TOKEN_REGISTERED_KEY, token],
        [TOKEN_REFRESHED_AT_KEY, String(Date.now())],
      ]);
      return true;
    }

    log.error('Push token registration failed:', response.status);
    return false;
  } catch (e) {
    log.error('Push token registration error:', e);
    return false;
  }
}

/**
 * Unregister the Expo push token from auth.veloq.fit.
 * Called on logout or when user disables notifications.
 */
export async function unregisterPushToken(athleteId: string): Promise<boolean> {
  const token = await getExpoPushToken();
  if (!token) return false;

  // Every sign-out path unregisters before it clears the credential, because
  // the worker will not take the word of a device that cannot prove who it is.
  const authorization = authorizationHeader(getStoredCredentials());
  if (!authorization) {
    log.warn('No credential to unregister a push token with');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/devices/unregister`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ athleteId, token }),
    });

    if (response.ok) {
      log.log('Push token unregistered');
      await AsyncStorage.multiRemove([TOKEN_REGISTERED_KEY, TOKEN_REFRESHED_AT_KEY]);
      return true;
    }

    log.error('Push token unregistration failed:', response.status);
    return false;
  } catch (e) {
    log.error('Push token unregistration error:', e);
    return false;
  }
}

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/shared/debug/debug';

const log = debug.create('PushToken');

/** Base URL for the API worker */
const API_URL = 'https://auth.veloq.fit';

/** Last successful registration refresh (ms epoch). Internal bookkeeping, not a user setting. */
const TOKEN_REFRESHED_AT_KEY = 'veloq-push-token-refreshed-at';

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
    const ok = await registerPushToken(athleteId);
    if (ok) {
      await AsyncStorage.setItem(TOKEN_REFRESHED_AT_KEY, String(Date.now()));
    }
  } catch (e) {
    log.warn('Push token refresh failed:', e);
  }
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

  try {
    const response = await fetch(`${API_URL}/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athleteId,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });

    if (response.ok) {
      log.log('Push token registered');
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

  try {
    const response = await fetch(`${API_URL}/devices/unregister`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId, token }),
    });

    if (response.ok) {
      log.log('Push token unregistered');
      return true;
    }

    log.error('Push token unregistration failed:', response.status);
    return false;
  } catch (e) {
    log.error('Push token unregistration error:', e);
    return false;
  }
}

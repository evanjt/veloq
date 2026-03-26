import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { debug } from '@/lib';

const log = debug.create('PushToken');

/** Base URL for the API worker */
const API_URL = 'https://auth.veloq.fit';

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

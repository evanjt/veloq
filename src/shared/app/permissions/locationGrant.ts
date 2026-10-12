import { Platform } from 'react-native';
import * as Location from 'expo-location';

import { openAppSettings } from './openAppSettings';

/**
 * How exact a granted location is. Android 12+ and iOS 14+ let the athlete
 * grant an approximate location in the same dialog, and the status still
 * reads granted, so a reader that keeps only the status cannot tell a ride
 * that will record a track from one whose every fix is too coarse to keep.
 */
export type LocationPrecision = 'precise' | 'approximate';

export interface LocationGrant {
  granted: boolean;
  precision: LocationPrecision;
}

/**
 * The foreground location grant as the app reads it. A response with no
 * platform detail is an OS from before the choice existed, so it is precise.
 */
export function locationGrant(response: Location.LocationPermissionResponse): LocationGrant {
  const approximate =
    response.android?.accuracy === 'coarse' || response.ios?.accuracy === 'reduced';
  return {
    granted: response.status === 'granted',
    precision: approximate ? 'approximate' : 'precise',
  };
}

/** Read the foreground grant without asking. */
export async function readLocationGrant(): Promise<LocationGrant> {
  return locationGrant(await Location.getForegroundPermissionsAsync());
}

/** Ask for the foreground grant, which reads it when already answered. */
export async function requestLocationGrant(): Promise<LocationGrant> {
  return locationGrant(await Location.requestForegroundPermissionsAsync());
}

/**
 * Offer precise location in place of approximate. Android shows its upgrade
 * dialog when fine location is asked for again, and answers with the new
 * grant. iOS offers the Precise switch only in Settings, so this opens them
 * and answers null: the grant is read again when the app returns.
 */
export async function upgradeLocationPrecision(): Promise<LocationGrant | null> {
  if (Platform.OS === 'android') return requestLocationGrant();
  openAppSettings();
  return null;
}

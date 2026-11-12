import { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { OrientationLock, lockAsync } from 'expo-screen-orientation';

import { mapSheetPanelWidth } from './screenHeaders';

/**
 * The orientation lock the app runs under, or null where it asks for none. The app launches
 * locked to portrait by `expo-screen-orientation`'s initial mask. iOS lets a window wide and tall
 * enough for the regular-width layouts, such as a foldable's unfolded display, turn with the
 * hand, and keeps every other window in portrait. Info.plist cannot say that for one display, so
 * it lists every orientation and this lock narrows it. Android's manifest lock and its resizability
 * opt-out already decide there.
 */
export function appOrientationLock(
  os: string,
  window: { width: number; height: number }
): OrientationLock | null {
  if (os !== 'ios') return null;
  return mapSheetPanelWidth(window) !== null ? OrientationLock.ALL : OrientationLock.PORTRAIT_UP;
}

/**
 * Keeps the lock `appOrientationLock` gives for the window's class. Only a change of class asks
 * again: a phone turned into landscape for the full-screen plot is still compact, and a lock
 * made on every size change would fight the plot's own.
 */
export function useAppOrientation(os: string = Platform.OS): void {
  const { width, height } = useWindowDimensions();
  const lock = appOrientationLock(os, { width, height });
  useEffect(() => {
    if (lock !== null) void lockAsync(lock);
  }, [lock]);
}

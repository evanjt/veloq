import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { permissionOutcome, type PermissionOutcome } from './outcome';

/** The notification permission as the system holds it now. */
export async function readNotificationPermission(): Promise<PermissionOutcome> {
  return permissionOutcome(await Notifications.getPermissionsAsync());
}

/**
 * Raise the notification dialog when the system will still show it, and
 * answer with the outcome after. A granted or blocked permission is returned
 * as it stands, so a call never spends one of Android's two dialogs for
 * nothing.
 */
export async function requestNotificationPermissionOutcome(): Promise<PermissionOutcome> {
  const current = await readNotificationPermission();
  if (current !== 'askable') return current;
  return permissionOutcome(await Notifications.requestPermissionsAsync());
}

/**
 * The notification outcome for a screen, read on mount and again whenever the
 * app returns to the foreground, which is how a change made in system
 * settings reaches it. Null until the first read answers.
 */
export function useNotificationPermission(): {
  outcome: PermissionOutcome | null;
  request: () => Promise<PermissionOutcome>;
} {
  const [outcome, setOutcome] = useState<PermissionOutcome | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      readNotificationPermission()
        .then((next) => {
          if (live) setOutcome(next);
        })
        .catch(() => undefined);
    };
    read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  const request = useCallback(async () => {
    const next = await requestNotificationPermissionOutcome();
    setOutcome(next);
    return next;
  }, []);

  return { outcome, request };
}

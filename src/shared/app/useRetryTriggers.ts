/**
 * The three edges that should make a failed network operation try again.
 *
 * The first two take the network state as a value. An effect keyed on a ref object runs
 * at mount and never again, because a ref's identity never changes, which is
 * how the route-sync reconnect path went quiet.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useNetwork } from './NetworkContext';

/** Run `onReconnect` on the offline to online edge, once per edge. */
export function useReconnect(onReconnect: () => void): void {
  const { isOnline } = useNetwork();
  const wasOnlineRef = useRef(isOnline);
  const callbackRef = useRef(onReconnect);
  useEffect(() => {
    callbackRef.current = onReconnect;
  });

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) callbackRef.current();
    wasOnlineRef.current = isOnline;
  }, [isOnline]);
}

/**
 * The end of a sync is the third edge, and the only one the user cannot cause.
 * A window the engine refused while the launch sync held the exclusive slot is
 * not a network failure, so neither a reconnect nor a foreground ever arrives
 * to retry it. The sync releasing the slot is the moment worth re-asking on.
 */
const settledListeners = new Set<() => void>();

/** Announce that a sync reached a terminal state and freed the slot. */
export function emitSyncSettled(): void {
  for (const listener of [...settledListeners]) listener();
}

/** Run `onSettled` whenever a sync finishes, whatever its outcome. */
export function useSyncSettled(onSettled: () => void): void {
  const callbackRef = useRef(onSettled);
  useEffect(() => {
    callbackRef.current = onSettled;
  });

  useEffect(() => {
    const listener = () => callbackRef.current();
    settledListeners.add(listener);
    return () => {
      settledListeners.delete(listener);
    };
  }, []);
}

/**
 * Run `onForeground` when the app returns to active from the background.
 *
 * iOS drops to `inactive` for a notification shade or a control centre pull, so
 * the previous state is tracked to keep that flicker from counting as a return.
 */
export function useForeground(onForeground: () => void): void {
  const callbackRef = useRef(onForeground);
  useEffect(() => {
    callbackRef.current = onForeground;
  });

  useEffect(() => {
    let wasBackgrounded = false;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        wasBackgrounded = true;
        return;
      }
      // iOS passes through `inactive` on the way back up, so the flag is what
      // says the app really left, not the state it was in one event ago.
      if (next === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        callbackRef.current();
      }
    });
    return () => subscription.remove();
  }, []);
}

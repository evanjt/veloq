/**
 * The two edges that should make a failed network operation try again.
 *
 * Both take the network state as a value. An effect keyed on a ref object runs
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

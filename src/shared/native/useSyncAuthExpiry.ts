/**
 * Bridge the Rust sync service's `authExpired` state onto the auth store.
 *
 * The Rust transport classifies a 401 and parks the service in `authExpired`,
 * but nothing observed that state, so an expired OAuth session was only ever
 * noticed by the axios interceptor. As reads move into Rust that interceptor
 * stops seeing most traffic, and this hook becomes the path that logs the user
 * out and shows the re-login prompt.
 *
 * `handleSessionExpired` is a no-op for API-key sessions, which never expire.
 */
import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';

import { useSyncStatus } from './useSyncStatus';

export function useSyncAuthExpiry(): void {
  const state = useSyncStatus()?.state;
  // One logout per expiry. The state stays authExpired until the next sync
  // begins, so without the latch every status poll would re-enter teardown.
  const handledRef = useRef(false);

  useEffect(() => {
    if (state !== 'authExpired') {
      handledRef.current = false;
      return;
    }
    if (handledRef.current) return;
    handledRef.current = true;
    void useAuthStore.getState().handleSessionExpired('token_expired');
  }, [state]);
}

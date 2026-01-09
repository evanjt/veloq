/**
 * @fileoverview useRouteSyncContext - Sync lifecycle management
 *
 * Manages the refs and abort controller for route sync operations.
 * Provides stable references that won't cause callback recreation.
 *
 * **Refs Managed:**
 * - isAuthenticatedRef: Current auth state
 * - isDemoModeRef: Current demo mode state
 * - isOnlineRef: Current network state
 * - isSyncingRef: Prevents concurrent syncs
 * - syncAbortRef: Aborts in-progress sync on unmount
 */

import { useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/providers';
import { useNetwork } from '@/providers';

interface UseRouteSyncContextResult {
  /** Ref tracking current authentication state */
  isAuthenticatedRef: React.MutableRefObject<boolean>;
  /** Ref tracking current demo mode state */
  isDemoModeRef: React.MutableRefObject<boolean>;
  /** Ref tracking current online status */
  isOnlineRef: React.MutableRefObject<boolean>;
  /** Ref preventing concurrent sync operations */
  isSyncingRef: React.MutableRefObject<boolean>;
  /** Ref holding abort controller for current sync */
  syncAbortRef: React.MutableRefObject<AbortController | null>;
  /**
   * Create a new abort controller for sync operation.
   * Replaces any existing controller (aborting previous sync).
   *
   * @returns New abort controller
   */
  createAbortController: () => AbortController;
  /**
   * Check if a sync operation can start.
   * Returns true if authenticated and not already syncing.
   *
   * @returns Whether sync can proceed
   */
  canStartSync: () => boolean;
  /**
   * Mark sync as complete (reset isSyncingRef and clear abort controller).
   */
  markSyncComplete: () => void;
}

/**
 * Hook for managing route sync lifecycle refs and abort controller.
 *
 * **Why Refs Instead of State?**
 * - Pro: Stable reference identity, no callback recreation
 * - Pro: Prevents race conditions from useCallback dependency changes
 * - Pro: No unnecessary re-renders when auth/network state changes
 * - Con: Slightly more complex access pattern (.current)
 *
 * **Abort Controller Pattern:**
 * - Created when sync starts
 * - Stored in ref for access from event listeners
 * - Checked before/after async operations
 * - Aborts in-flight HTTP requests on unmount
 * - Cleared when sync completes
 *
 * @example
 * ```tsx
 * const { isSyncingRef, createAbortController, canStartSync } = useRouteSyncContext();
 *
 * // Before sync
 * if (!canStartSync()) return;
 * const abortController = createAbortController();
 *
 * // During async operation
 * if (abortController.signal.aborted) return;
 *
 * // After completion
 * markSyncComplete();
 * ```
 */
export function useRouteSyncContext(): UseRouteSyncContextResult {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { isOnline } = useNetwork();

  // Refs for stable callback identity
  const isAuthenticatedRef = useRef(isAuthenticated);
  const isDemoModeRef = useRef(isDemoMode);
  const isOnlineRef = useRef(isOnline);
  const isSyncingRef = useRef(false);
  const syncAbortRef = useRef<AbortController | null>(null);

  // Keep refs in sync with current values
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
    isDemoModeRef.current = isDemoMode;
    isOnlineRef.current = isOnline;
  }, [isAuthenticated, isDemoMode, isOnline]);

  /**
   * Create abort controller for sync operation.
   * Aborts any previous sync in progress.
   */
  const createAbortController = useCallback(() => {
    const abortController = new AbortController();
    syncAbortRef.current = abortController;
    return abortController;
  }, []);

  /**
   * Check if sync can start.
   * Requires authentication and no concurrent sync.
   */
  const canStartSync = useCallback(() => {
    const isAuth = isAuthenticatedRef.current;
    if (!isAuth || isSyncingRef.current) {
      return false;
    }
    isSyncingRef.current = true;
    return true;
  }, []);

  /**
   * Mark sync as complete and cleanup.
   */
  const markSyncComplete = useCallback(() => {
    isSyncingRef.current = false;
    syncAbortRef.current = null;
  }, []);

  return {
    isAuthenticatedRef,
    isDemoModeRef,
    isOnlineRef,
    isSyncingRef,
    syncAbortRef,
    createAbortController,
    canStartSync,
    markSyncComplete,
  };
}

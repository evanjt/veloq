/**
 * @fileoverview useRouteSyncProgress - Progress state management
 *
 * Manages the progress state for route data synchronization.
 * Provides safe state updates that respect component mount status.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface SyncProgress {
  status: 'idle' | 'fetching' | 'processing' | 'computing' | 'complete' | 'error';
  completed: number;
  total: number;
  percent: number;
  message: string;
}

interface UseRouteSyncProgressResult {
  /** Current progress state */
  progress: SyncProgress;
  /** Whether currently syncing (fetching, processing, or computing) */
  isSyncing: boolean;
  /**
   * Safely update progress state.
   * Checks mount state before updating to prevent memory leaks.
   *
   * @param updater - New progress object or updater function
   */
  updateProgress: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void;
  /** Whether the component is currently mounted */
  isMountedRef: React.MutableRefObject<boolean>;
}

/**
 * Hook for managing route sync progress state with mount guards.
 *
 * **Features:**
 * - Mount-safe updates: Prevents state updates after unmount
 * - Derived isSyncing: Computed from progress.status
 * - Ref-based mount tracking: Used by parent hooks for coordination
 *
 * **Usage:**
 * This hook is typically used by useRouteDataSync to provide
 * progress tracking to the sync operation.
 *
 * @example
 * ```tsx
 * const { progress, updateProgress, isMountedRef } = useRouteSyncProgress();
 *
 * // Safe update even after unmount
 * updateProgress({ status: 'fetching', completed: 0, total: 10, message: '...' });
 * ```
 */
export function useRouteSyncProgress(): UseRouteSyncProgressResult {
  const [progress, setProgress] = useState<SyncProgress>({
    status: 'idle',
    completed: 0,
    total: 0,
    percent: 0,
    message: '',
  });

  // Track mount state for safe updates
  const isMountedRef = useRef(true);

  // Setup mount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Safely update progress state.
   * Only updates if component is still mounted.
   */
  const updateProgress = useCallback(
    (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => {
      if (isMountedRef.current) {
        setProgress(updater);
      }
    },
    []
  );

  // Derive syncing state from progress
  const isSyncing =
    progress.status === 'fetching' ||
    progress.status === 'processing' ||
    progress.status === 'computing';

  return {
    progress,
    isSyncing,
    updateProgress,
    isMountedRef,
  };
}

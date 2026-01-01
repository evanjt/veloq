/**
 * Hook for route processing status and controls.
 * Processing is now handled by the Rust engine.
 */

import { useCallback, useState } from 'react';
import type { ActivityType } from '@/types';

// Lazy load native module to avoid bundler errors
let _routeEngine: typeof import('route-matcher-native').routeEngine | null = null;
function getRouteEngine() {
  if (!_routeEngine) {
    try {
      _routeEngine = require('route-matcher-native').routeEngine;
    } catch {
      return null;
    }
  }
  return _routeEngine;
}

interface RouteProcessingProgress {
  status: 'idle' | 'processing' | 'complete' | 'error';
  current: number;
  total: number;
  message: string;
}

interface UseRouteProcessingResult {
  /** Current processing progress */
  progress: RouteProcessingProgress;
  /** Whether processing is currently active */
  isProcessing: boolean;
  /** Cancel current processing */
  cancel: () => void;
  /** Clear all route cache and start fresh */
  clearCache: () => Promise<void>;
  /** Add activities to the engine */
  addActivities: (
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ) => Promise<void>;
}

export function useRouteProcessing(): UseRouteProcessingResult {
  const [progress, setProgress] = useState<RouteProcessingProgress>({
    status: 'idle',
    current: 0,
    total: 0,
    message: '',
  });

  const isProcessing = progress.status === 'processing';

  const cancel = useCallback(() => {
    // Rust engine doesn't support cancellation yet
    setProgress(p => ({ ...p, status: 'idle' }));
  }, []);

  const clearCache = useCallback(async () => {
    const engine = getRouteEngine();
    if (engine) engine.clear();
    setProgress({ status: 'idle', current: 0, total: 0, message: '' });
  }, []);

  const addActivities = useCallback(async (
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ) => {
    setProgress({
      status: 'processing',
      current: 0,
      total: activityIds.length,
      message: 'Adding activities...',
    });

    try {
      const engine = getRouteEngine();
      if (engine) {
        engine.addActivities(activityIds, allCoords, offsets, sportTypes);
      }
      setProgress({
        status: 'complete',
        current: activityIds.length,
        total: activityIds.length,
        message: 'Complete',
      });
    } catch (error) {
      setProgress({
        status: 'error',
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  return {
    progress,
    isProcessing,
    cancel,
    clearCache,
    addActivities,
  };
}

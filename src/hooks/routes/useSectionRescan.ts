/**
 * Hook for triggering and monitoring section re-detection.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';

interface SectionRescanState {
  /** Start incremental detection (normal — only new activities). */
  rescan: (sportFilter?: string) => boolean;
  /** Force full re-detection (clears processed IDs, re-evaluates all activities). */
  forceRescan: (sportFilter?: string) => boolean;
  /** Whether detection is currently running. */
  isScanning: boolean;
  /** Current detection progress phase and counts. */
  progress: { phase: string; completed: number; total: number } | null;
}

export function useSectionRescan(): SectionRescanState {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SectionRescanState['progress']>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsScanning(false);
    setProgress(null);
  }, []);

  const startPolling = useCallback(() => {
    setIsScanning(true);
    pollRef.current = setInterval(() => {
      const engine = getRouteEngine();
      if (!engine) return;
      const status = engine.pollSectionDetection();
      if (status === 'complete' || status === 'idle') {
        stopPolling();
      } else {
        const p = engine.getSectionDetectionProgress();
        if (p) {
          setProgress({ phase: p.phase, completed: p.completed, total: p.total });
        }
      }
    }, 500);
  }, [stopPolling]);

  const rescan = useCallback(
    (sportFilter?: string) => {
      const engine = getRouteEngine();
      if (!engine) return false;
      const started = engine.startSectionDetection(sportFilter);
      if (started) startPolling();
      return started;
    },
    [startPolling]
  );

  const forceRescan = useCallback(
    (sportFilter?: string) => {
      const engine = getRouteEngine();
      if (!engine) return false;
      const started = engine.forceRedetectSections(sportFilter);
      if (started) startPolling();
      return started;
    },
    [startPolling]
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { rescan, forceRescan, isScanning, progress };
}

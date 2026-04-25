import { useState, useCallback, useRef, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';

interface RescanResult {
  before: number;
  after: number;
}

interface SectionRescanState {
  rescan: (sportFilter?: string) => boolean;
  forceRescan: (sportFilter?: string) => boolean;
  isScanning: boolean;
  progress: { phase: string; completed: number; total: number } | null;
  result: RescanResult | null;
  clearResult: () => void;
}

function getSectionCount(): number {
  const engine = getRouteEngine();
  if (!engine) return 0;
  try {
    const { totalCount } = engine.getFilteredSectionSummaries(undefined, 1, 'visits');
    return totalCount;
  } catch {
    return 0;
  }
}

export function useSectionRescan(): SectionRescanState {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SectionRescanState['progress']>(null);
  const [result, setResult] = useState<RescanResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beforeCountRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    setIsScanning(true);
    setResult(null);
    pollRef.current = setInterval(() => {
      const engine = getRouteEngine();
      if (!engine) return;
      const status = engine.pollSectionDetection();
      if (status === 'complete' || status === 'idle') {
        stopPolling();
        const after = getSectionCount();
        setResult({ before: beforeCountRef.current, after });
        setIsScanning(false);
        setProgress(null);
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
      beforeCountRef.current = getSectionCount();
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
      beforeCountRef.current = getSectionCount();
      const started = engine.forceRedetectSections(sportFilter);
      if (started) startPolling();
      return started;
    },
    [startPolling]
  );

  const clearResult = useCallback(() => setResult(null), []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { rescan, forceRescan, isScanning, progress, result, clearResult };
}

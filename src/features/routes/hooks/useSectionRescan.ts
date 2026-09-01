import { useState, useCallback, useRef, useEffect } from 'react';
import { getEngine } from '@/shared/native/engine';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';

interface RescanResult {
  before: number;
  after: number;
}

interface RescanProgress {
  phase: string;
  displayName: string;
  completed: number;
  total: number;
  percent: number;
}

interface SectionRescanState {
  rescan: () => boolean;
  forceRescan: () => boolean;
  isScanning: boolean;
  progress: RescanProgress | null;
  result: RescanResult | null;
  failed: boolean;
  clearResult: () => void;
}

function getSectionCount(): number {
  const engine = getEngine();
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
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
    pollRef.current = setInterval(() => {
      const engine = getEngine();
      if (!engine) return;
      const status = engine.pollSectionDetection();
      if (status === 'error') {
        // A detection that aborts must not read as a rescan that changed
        // nothing: the next poll returns 'idle', which is indistinguishable
        // from a clean finish.
        stopPolling();
        setFailed(true);
        setIsScanning(false);
        setProgress(null);
      } else if (status === 'complete' || status === 'idle') {
        stopPolling();
        const after = getSectionCount();
        setResult({ before: beforeCountRef.current, after });
        setIsScanning(false);
        setProgress(null);
      } else {
        const p = engine.getSectionDetectionProgress();
        if (p) {
          setProgress({
            phase: p.phase,
            displayName: getPhaseDisplayName(p.phase),
            completed: p.completed,
            total: p.total,
            percent: p.percent,
          });
        }
      }
    }, 500);
  }, [stopPolling]);

  const rescan = useCallback(() => {
    const engine = getEngine();
    if (!engine) return false;
    beforeCountRef.current = getSectionCount();
    const started = engine.startSectionDetection();
    if (started) startPolling();
    return started;
  }, [startPolling]);

  const forceRescan = useCallback(() => {
    const engine = getEngine();
    if (!engine) return false;
    beforeCountRef.current = getSectionCount();
    const started = engine.forceRedetectSections();
    if (started) startPolling();
    return started;
  }, [startPolling]);

  const clearResult = useCallback(() => {
    setResult(null);
    setFailed(false);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return { rescan, forceRescan, isScanning, progress, result, failed, clearResult };
}

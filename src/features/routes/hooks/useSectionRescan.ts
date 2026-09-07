import { useState, useCallback, useRef, useEffect } from 'react';
import { hasStarted, StartOutcome } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import { followDetection, type DetectionEngine } from '@/features/routes/lib/detectionRun';

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
  /**
   * Ask for a rescan. The verdict says why a refusal happened, so a caller can
   * tell a run that is already going, which frees on its own, from a detection
   * the backfill is holding.
   */
  rescan: () => StartOutcome;
  forceRescan: () => StartOutcome;
  /**
   * The last refusal, for the screen to name. Held as state because the
   * verdict is returned once and every consumer of it was dropping it.
   */
  refusal: StartOutcome | null;
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
  const [refusal, setRefusal] = useState<StartOutcome | null>(null);
  const followRef = useRef<(() => void) | null>(null);
  const beforeCountRef = useRef(0);
  // A run this hook did not start has no honest "before" to report, so the
  // poll shows its progress and publishes no result when it settles.
  const adoptedRef = useRef(false);

  // Rust announces the end on `detectionApplied`, so the terminal status is
  // read once, there. The timer that remains reads progress alone: it never
  // drains the worker's channel, so a tick cannot consume the completion.
  const startPolling = useCallback(() => {
    const engine = getEngine();
    if (!engine) return;
    setIsScanning(true);
    setResult(null);
    setFailed(false);

    const follow = followDetection(engine as unknown as DetectionEngine, {
      onProgress: (p) =>
        setProgress({
          phase: p.phase,
          displayName: getPhaseDisplayName(p.phase),
          completed: p.completed,
          total: p.total,
          percent: p.percent,
        }),
    });
    followRef.current = follow.cancel;

    void follow.settled.then((outcome) => {
      if (outcome === 'abandoned') return;
      followRef.current = null;
      setIsScanning(false);
      setProgress(null);
      // A detection that aborts must not read as a rescan that changed
      // nothing: a later poll returns 'idle', which is indistinguishable
      // from a clean finish.
      if (outcome === 'error') {
        setFailed(true);
        return;
      }
      if (!adoptedRef.current) {
        setResult({ before: beforeCountRef.current, after: getSectionCount() });
      }
      adoptedRef.current = false;
    });
  }, []);

  /** Record the verdict, and keep a started run free of a stale refusal. */
  const adopt = useCallback(
    (outcome: StartOutcome) => {
      setRefusal(hasStarted(outcome) ? null : outcome);
      if (hasStarted(outcome)) startPolling();
      return outcome;
    },
    [startPolling]
  );

  const rescan = useCallback(() => {
    const engine = getEngine();
    if (!engine) return adopt(StartOutcome.NotReady);
    beforeCountRef.current = getSectionCount();
    adoptedRef.current = false;
    return adopt(engine.startSectionDetection());
  }, [adopt]);

  const forceRescan = useCallback(() => {
    const engine = getEngine();
    if (!engine) return adopt(StartOutcome.NotReady);
    beforeCountRef.current = getSectionCount();
    adoptedRef.current = false;
    return adopt(engine.forceRedetectSections());
  }, [adopt]);

  const clearResult = useCallback(() => {
    setResult(null);
    setFailed(false);
    setRefusal(null);
  }, []);

  // A detect started elsewhere, by another screen or by the preview's Keep,
  // is invisible unless whoever mounts next picks it up. Adopt it so the
  // progress follows the run rather than the screen that began it.
  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;
    // Defensive like every other FFI read here: a host that cannot answer must
    // not cost the screen its mount.
    let running = false;
    try {
      running = engine.pollSectionDetection?.() === 'running';
    } catch {
      running = false;
    }
    if (running) {
      adoptedRef.current = true;
      startPolling();
    }
  }, [startPolling]);

  useEffect(() => {
    return () => {
      followRef.current?.();
      followRef.current = null;
    };
  }, []);

  return { rescan, forceRescan, refusal, isScanning, progress, result, failed, clearResult };
}

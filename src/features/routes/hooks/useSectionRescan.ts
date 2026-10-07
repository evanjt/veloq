import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { hasStarted, StartOutcome, type StartVerdict } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { attemptEngineRead } from '@/shared/native/engineError';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import {
  DETECTION_FOREGROUND_MS,
  followDetection,
  type DetectionEngine,
} from '@/features/routes/lib/detectionRun';

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
  rescan: () => StartVerdict;
  forceRescan: () => StartVerdict;
  /**
   * The last refusal, for the screen to name. Held as state because the
   * verdict is returned once and every consumer of it was dropping it.
   */
  refusal: StartVerdict | null;
  /**
   * Ask the running scan to stop. False when there was none.
   *
   * Cooperative: the worker ends at its next stage boundary, so the spinner
   * clears when the run reports its end rather than on this call.
   */
  cancelScan: () => boolean;
  isScanning: boolean;
  /**
   * True once the follow has hit its budget with the run still going. Not a
   * failure: Rust is still detecting and the athlete can leave the screen.
   */
  stillRunning: boolean;
  progress: RescanProgress | null;
  result: RescanResult | null;
  failed: boolean;
  clearResult: () => void;
}

/**
 * The before and after of a rescan. A SQL count, not a summary load: the
 * totals are read on every tap and the summaries were only ever a way of
 * reaching the number beside them. Null when the count could not be read, so a
 * failed read never becomes a before or after of zero.
 */
function getSectionCount(): number | null {
  const engine = getEngine();
  if (!engine) return null;
  const read = attemptEngineRead(() => engine.getSectionCount());
  return read.ok ? read.value : null;
}

export function useSectionRescan(): SectionRescanState {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SectionRescanState['progress']>(null);
  const [result, setResult] = useState<RescanResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [stillRunning, setStillRunning] = useState(false);
  const isMountedRef = useRef(true);
  const [refusal, setRefusal] = useState<StartVerdict | null>(null);
  const followRef = useRef<(() => void) | null>(null);
  const beforeCountRef = useRef<number | null>(null);
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
    setStillRunning(false);
    const follow = followDetection(engine as unknown as DetectionEngine, {
      // The run's end comes from an announcement, and an announcement can be
      // withheld: the observer is not registered when the binding checksum
      // check throws, which is what a library out of step with its bindings
      // does. Without a budget that build scans for ever.
      timeoutMs: DETECTION_FOREGROUND_MS,
      isActive: () => isMountedRef.current,
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
      // A run this hook stopped following did not finish for it, whatever it
      // went on to do. Reporting a before and after it never measured would be
      // worse than saying so.
      // The budget running out says nothing about the run: only an outcome the
      // engine itself reported is a failure.
      if (outcome === 'timeout') {
        setStillRunning(true);
        return;
      }
      if (outcome === 'error') {
        setFailed(true);
        return;
      }
      if (!adoptedRef.current) {
        const before = beforeCountRef.current;
        const after = getSectionCount();
        if (before !== null && after !== null) setResult({ before, after });
      }
      adoptedRef.current = false;
    });
  }, []);

  /** Record the verdict, and keep a started run free of a stale refusal. */
  const adopt = useCallback(
    (outcome: StartVerdict) => {
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

  const cancelScan = useCallback(() => {
    const engine = getEngine();
    if (!engine) return false;
    return engine.cancelSectionDetection();
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setFailed(false);
    setStillRunning(false);
    setRefusal(null);
  }, []);

  // A detect started elsewhere, by another screen or by the preview's Keep,
  // is invisible unless whoever shows next picks it up. Adopt it on every
  // focus, since a screen under the preview does not remount when Keep pops back.
  useFocusEffect(
    useCallback(() => {
      const engine = getEngine();
      if (!engine) return;
      // Defensive like every other FFI read here: a host that cannot answer must
      // not cost the screen its mount.
      let running = false;
      try {
        running = engine.getSectionDetectionProgress?.() != null;
      } catch {
        running = false;
      }
      if (running) {
        adoptedRef.current = true;
        startPolling();
      }
    }, [startPolling])
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      followRef.current?.();
      followRef.current = null;
    };
  }, []);

  return {
    rescan,
    forceRescan,
    cancelScan,
    refusal,
    isScanning,
    stillRunning,
    progress,
    result,
    failed,
    clearResult,
  };
}

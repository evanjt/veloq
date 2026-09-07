/**
 * Drives one preview detection run against a PreviewClient.
 *
 * Nothing touches the engine until start() is called with a centre and the
 * staged slider values. The run's end comes from the engine's
 * `previewFinished` announcement, and the status read that follows it mirrors
 * the engine's state machine: idle, running, complete, cancelled, error. The
 * result is taken from the client exactly once.
 *
 * Progress is read when the engine announces a phase, four times a run. A
 * per-track event is not an option: the loader increments once per activity
 * and the observer binding blocks the calling Rust thread until JavaScript
 * returns, so a few hundred activities would be a few hundred blocking calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StartOutcome } from 'veloqrs';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import type {
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
} from '../../../../modules/veloqrs/src/delegates/preview';

export interface PreviewProgress {
  phase: string;
  displayName: string;
  completed: number;
  total: number;
  percent: number;
}

export interface PreviewDetectState {
  status: PreviewPollStatus;
  progress: PreviewProgress | null;
  result: PreviewResult | null;
  /** True when start was refused, ie. another run or the elevation backfill. */
  suspended: boolean;
  /**
   * Ask for a preview run. The verdict names the refusal: a run already going
   * or a backfill holding detection both lift on their own, a missing config
   * does not.
   */
  start: (lat: number, lng: number, params: PreviewParams) => StartOutcome;
  cancel: () => void;
  reset: () => void;
}

export function usePreviewDetect(client: PreviewClient | null): PreviewDetectState {
  const [status, setStatus] = useState<PreviewPollStatus>('idle');
  const [progress, setProgress] = useState<PreviewProgress | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [suspended, setSuspended] = useState(false);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const runningRef = useRef(false);

  const stopRun = useCallback(() => {
    unsubscribeRef.current.forEach((off) => off());
    unsubscribeRef.current = [];
    runningRef.current = false;
  }, []);

  const settle = useCallback(() => {
    if (!client || !runningRef.current) return;
    const polled = client.pollPreviewDetect();
    // The engine announces only once the outcome is readable, so a status
    // still reading running is a stray event and the run stays live.
    if (polled === 'running') return;
    stopRun();
    if (polled === 'complete') {
      setResult(client.takePreviewResult());
      setStatus('complete');
    } else {
      // Idle at the announcement means the engine lost the run.
      setStatus(polled === 'idle' ? 'error' : polled);
    }
    setProgress(null);
  }, [client, stopRun]);

  const readProgress = useCallback(() => {
    if (!client || !runningRef.current) return;
    const p = client.getPreviewProgress();
    if (!p) return;
    setProgress({
      phase: p.phase,
      displayName: getPhaseDisplayName(p.phase),
      completed: p.completed,
      total: p.total,
      percent: p.percent,
    });
  }, [client]);

  const start = useCallback(
    (lat: number, lng: number, params: PreviewParams): StartOutcome => {
      if (!client) return StartOutcome.NotReady;
      if (runningRef.current) return StartOutcome.Busy;
      const config = client.getSectionConfig();
      if (!config) {
        setStatus('error');
        return StartOutcome.NotConfigured;
      }
      setSuspended(false);
      // The previous result stands until this run settles. During a run there
      // is no newer answer, and the old one is still the truth about the last
      // parameters, so clearing it here left the map blank for the length of
      // the run. A cancelled or failed run leaves it standing for the same
      // reason. The screen clears it when the area changes, which is the one
      // case where the held diff is about somewhere else.
      setProgress(null);
      const started = client.startPreviewDetect(lat, lng, { ...config, ...params });
      if (!started) {
        // The engine refuses only while a detect runs or the backfill holds
        // detection, and both end, so this is the refusal worth asking about
        // again rather than the one that never changes.
        setSuspended(true);
        setStatus('idle');
        return StartOutcome.Held;
      }
      setStatus('running');
      runningRef.current = true;
      unsubscribeRef.current = [
        client.subscribe('previewFinished', settle),
        client.subscribe('previewPhase', readProgress),
      ];
      return StartOutcome.Started;
    },
    [client, settle, readProgress]
  );

  const cancel = useCallback(() => {
    if (!client || !runningRef.current) return;
    client.cancelPreviewDetect();
    stopRun();
    setStatus('cancelled');
    setProgress(null);
  }, [client, stopRun]);

  const reset = useCallback(() => {
    stopRun();
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setSuspended(false);
  }, [stopRun]);

  useEffect(() => {
    return () => {
      if (runningRef.current) client?.cancelPreviewDetect();
      stopRun();
    };
  }, [client, stopRun]);

  return { status, progress, result, suspended, start, cancel, reset };
}

/**
 * Drives one preview detection run against a PreviewClient.
 *
 * Nothing touches the engine until start() is called with a centre and the
 * staged slider values. The run's end comes from the engine's
 * `previewFinished` announcement, and the status read that follows it mirrors
 * the engine's state machine: idle, running, complete, cancelled, error. The
 * result is taken from the client exactly once.
 *
 * The percent the run button draws advances per loaded track, so progress is
 * read on a cadence rather than announced: an event per track would cost a
 * blocking call into JavaScript for every activity in the pool.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import type {
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
} from '../../../../modules/veloqrs/src/delegates/preview';

const PROGRESS_MS = 500;

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
  start: (lat: number, lng: number, params: PreviewParams) => boolean;
  cancel: () => void;
  reset: () => void;
}

export function usePreviewDetect(client: PreviewClient | null): PreviewDetectState {
  const [status, setStatus] = useState<PreviewPollStatus>('idle');
  const [progress, setProgress] = useState<PreviewProgress | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [suspended, setSuspended] = useState(false);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);

  const stopRun = useCallback(() => {
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
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

  const watchProgress = useCallback(() => {
    if (!client) return;
    progressRef.current = setInterval(() => {
      const p = client.getPreviewProgress();
      if (!p) return;
      setProgress({
        phase: p.phase,
        displayName: getPhaseDisplayName(p.phase),
        completed: p.completed,
        total: p.total,
        percent: p.percent,
      });
    }, PROGRESS_MS);
  }, [client]);

  const start = useCallback(
    (lat: number, lng: number, params: PreviewParams): boolean => {
      if (!client || runningRef.current) return false;
      const config = client.getSectionConfig();
      if (!config) {
        setStatus('error');
        return false;
      }
      setSuspended(false);
      setResult(null);
      setProgress(null);
      const started = client.startPreviewDetect(lat, lng, { ...config, ...params });
      if (!started) {
        setSuspended(true);
        setStatus('idle');
        return false;
      }
      setStatus('running');
      runningRef.current = true;
      unsubscribeRef.current = client.subscribe('previewFinished', settle);
      watchProgress();
      return true;
    },
    [client, settle, watchProgress]
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

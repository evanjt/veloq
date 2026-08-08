/**
 * Drives one preview detection run against a PreviewClient.
 *
 * Nothing touches the engine until start() is called with a centre and the
 * staged slider values. While a run is live the hook polls every 500 ms and
 * mirrors the engine's state machine: idle, running, complete, cancelled,
 * error. The result is taken from the client exactly once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import type {
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
} from '../../../../modules/veloqrs/src/delegates/preview';

const POLL_MS = 500;

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const startPolling = useCallback(() => {
    if (!client) return;
    runningRef.current = true;
    pollRef.current = setInterval(() => {
      const polled = client.pollPreviewDetect();
      if (polled === 'complete') {
        stopPolling();
        setResult(client.takePreviewResult());
        setStatus('complete');
        setProgress(null);
      } else if (polled === 'running') {
        const p = client.getPreviewProgress();
        if (p) {
          setProgress({
            phase: p.phase,
            displayName: getPhaseDisplayName(p.phase),
            completed: p.completed,
            total: p.total,
            percent: p.percent,
          });
        }
      } else {
        // Idle mid-run means the engine lost the run; surface it as an error.
        stopPolling();
        setStatus(polled === 'idle' ? 'error' : polled);
        setProgress(null);
      }
    }, POLL_MS);
  }, [client, stopPolling]);

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
      startPolling();
      return true;
    },
    [client, startPolling]
  );

  const cancel = useCallback(() => {
    if (!client || !runningRef.current) return;
    client.cancelPreviewDetect();
    stopPolling();
    setStatus('cancelled');
    setProgress(null);
  }, [client, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setSuspended(false);
  }, [stopPolling]);

  useEffect(() => {
    return () => {
      if (runningRef.current) client?.cancelPreviewDetect();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [client]);

  return { status, progress, result, suspended, start, cancel, reset };
}

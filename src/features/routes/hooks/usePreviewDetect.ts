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
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';
import type {
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
} from '../../../../modules/veloqrs/src/delegates/preview';

/**
 * How often a lapsed run's status is re-read. The read is one poll of the
 * engine's state machine, not a drain of the worker's channel, so it cannot
 * consume the completion the event reports.
 */
export const PREVIEW_POLL_INTERVAL_MS = 1000;

/**
 * How long a run may go before the screen says it is taking a while, and
 * before the fallback poll arms. A healthy run carries no status poll on
 * purpose, so until this budget passes the hook reads nothing at all between
 * the start and the event.
 */
export const PREVIEW_LAPSE_AFTER_MS = 45_000;

/** How long a run may go before it is called failed. */
export const PREVIEW_TIMEOUT_MS = 5 * 60_000;

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
  /** True once a still-running run has outlived its lapse budget. */
  lapsed: boolean;
  start: (lat: number, lng: number, params: PreviewParams) => boolean;
  cancel: () => void;
  reset: () => void;
}

export function usePreviewDetect(client: PreviewClient | null): PreviewDetectState {
  const [status, setStatus] = useState<PreviewPollStatus>('idle');
  const [progress, setProgress] = useState<PreviewProgress | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const runningRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopRun = useCallback(() => {
    unsubscribeRef.current.forEach((off) => off());
    unsubscribeRef.current = [];
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
    runningRef.current = false;
  }, []);

  const settle = useCallback(() => {
    if (!client || !runningRef.current) return false;
    const polled = client.pollPreviewDetect();
    // The engine announces only once the outcome is readable, so a status
    // still reading running is a stray event and the run stays live.
    if (polled === 'running') return false;
    stopRun();
    if (polled === 'complete') {
      setResult(client.takePreviewResult());
      setStatus('complete');
    } else {
      // Idle at the announcement means the engine lost the run.
      setStatus(polled === 'idle' ? 'error' : polled);
    }
    setProgress(null);
    return true;
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
    (lat: number, lng: number, params: PreviewParams): boolean => {
      if (!client || runningRef.current) return false;
      const config = client.getSectionConfig();
      if (!config) {
        setStatus('error');
        return false;
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
        setSuspended(true);
        setStatus('idle');
        return false;
      }
      setStatus('running');
      setLapsed(false);
      runningRef.current = true;
      unsubscribeRef.current = [
        client.subscribe('previewFinished', settle),
        client.subscribe('previewPhase', readProgress),
      ];
      // The end comes from an event, and an event can be dropped: the observer
      // is withheld when the binding checksum fails, and a run that dies
      // between the announcement and its delivery announces to nobody. A run
      // that outlives its lapse budget is abnormal by then, so that is where
      // the fallback poll arms, and the timeout bounds a run that reaches no
      // terminal state at all.
      timersRef.current = [
        setTimeout(() => {
          setLapsed(true);
          const poller = setInterval(settle, PREVIEW_POLL_INTERVAL_MS);
          timersRef.current.push(poller as unknown as ReturnType<typeof setTimeout>);
        }, PREVIEW_LAPSE_AFTER_MS),
        setTimeout(() => {
          // One last read, since a run that ended without its event is a
          // finished preview and not a failed one.
          if (settle()) return;
          // Nobody follows this run any more, and a run left holding the
          // single preview slot refuses the next start as a suspension.
          client.cancelPreviewDetect();
          stopRun();
          setStatus('error');
          setProgress(null);
        }, PREVIEW_TIMEOUT_MS),
      ];
      return true;
    },
    [client, settle, readProgress, stopRun]
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
    setLapsed(false);
  }, [stopRun]);

  useEffect(() => {
    return () => {
      if (runningRef.current) client?.cancelPreviewDetect();
      stopRun();
    };
  }, [client, stopRun]);

  return { status, progress, result, suspended, lapsed, start, cancel, reset };
}

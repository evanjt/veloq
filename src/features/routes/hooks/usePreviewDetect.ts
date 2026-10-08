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
 *
 * `request` is the slider's way in. It waits for the values to stand still,
 * and a run already going is cancelled and its end awaited before the new one
 * starts: the engine's cancel is cooperative, so the old run holds the slot
 * until it notices, and a start before then is refused as busy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StartOutcome,
  startOutcome,
  type StartVerdict,
  type PreviewClient,
  type PreviewParams,
  type PreviewPollStatus,
  type PreviewResult,
} from 'veloqrs';
import { createAwakeClock } from '@/shared/app/awakeClock';
import { attemptEngineRead, engineErrorTag } from '@/shared/native/engineError';

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

/**
 * How long the values must stand still after a slider is released before a
 * run starts. A release already means the athlete has stopped dragging, so
 * this only coalesces several adjustments made one after another into one run
 * rather than starting and cancelling a run for each.
 */
export const PREVIEW_DEBOUNCE_MS = 400;

interface PreviewRequest {
  lat: number;
  lng: number;
  params: PreviewParams;
}

export interface PreviewProgress {
  phase: string;
  completed: number;
  total: number;
  percent: number;
}

export interface PreviewDetectState {
  status: PreviewPollStatus;
  progress: PreviewProgress | null;
  result: PreviewResult | null;
  /** The engine's refusal of the last start, or null when it started. */
  refusal: StartVerdict | null;
  /** True once a still-running run has outlived its lapse budget. */
  lapsed: boolean;
  /**
   * Ask for a preview run. The verdict names the refusal, and the same value
   * stays in `refusal` until the next start.
   */
  start: (lat: number, lng: number, params: PreviewParams) => StartVerdict;
  /**
   * Ask for a run at these values once they have stood still, superseding a
   * run in flight. A refusal lands in `refusal` as it does for `start`.
   */
  request: (lat: number, lng: number, params: PreviewParams) => void;
  cancel: () => void;
  reset: () => void;
}

export function usePreviewDetect(client: PreviewClient | null): PreviewDetectState {
  const [status, setStatus] = useState<PreviewPollStatus>('idle');
  const [progress, setProgress] = useState<PreviewProgress | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [refusal, setRefusal] = useState<StartVerdict | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const runningRef = useRef(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The values a superseded run is being cancelled for. Set only while the old
  // run winds down, and started from its end.
  const pendingRef = useRef<PreviewRequest | null>(null);
  const startRef = useRef<(lat: number, lng: number, params: PreviewParams) => StartVerdict>(
    () => StartOutcome.NotReady
  );

  const stopRun = useCallback(() => {
    unsubscribeRef.current.forEach((off) => off());
    unsubscribeRef.current = [];
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = null;
    runningRef.current = false;
  }, []);

  const dropRequest = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    pendingRef.current = null;
  }, []);

  const settle = useCallback(() => {
    if (!client || !runningRef.current) return false;
    const polled = client.pollPreviewDetect();
    // The engine announces only once the outcome is readable, so a status
    // still reading running is a stray event and the run stays live.
    if (polled === 'running') return false;
    stopRun();
    const pending = pendingRef.current;
    if (pending) {
      // The run was cut for values the athlete has moved off, so however it
      // ended it is not shown. An untaken payload is reaped by the next start.
      pendingRef.current = null;
      startRef.current(pending.lat, pending.lng, pending.params);
      return true;
    }
    if (polled === 'complete') {
      // Settled from a timer as well as an announcement, so a failed take is
      // the run's error state rather than a throw nothing catches.
      const taken = attemptEngineRead(() => client.takePreviewResult());
      if (taken.ok) {
        setResult(taken.value);
        setStatus('complete');
      } else {
        console.warn(
          '[PreviewDetect] Could not take the result:',
          engineErrorTag(taken.error) ?? taken.error
        );
        setStatus('error');
      }
    } else {
      // Idle at the announcement means the engine lost the run.
      setStatus(polled === 'idle' ? 'error' : polled);
    }
    setProgress(null);
    return true;
  }, [client, stopRun]);

  const readProgress = useCallback(() => {
    // A superseded run's phases describe work nobody is waiting for.
    if (!client || !runningRef.current || pendingRef.current) return;
    // Progress is advisory: a failed read leaves the last figures and the run
    // settles on its own announcement.
    const p = attemptEngineRead(() => client.getPreviewProgress()).value;
    if (!p) return;
    setProgress({
      phase: p.phase,
      completed: p.completed,
      total: p.total,
      percent: p.percent,
    });
  }, [client]);

  const start = useCallback(
    (lat: number, lng: number, params: PreviewParams): StartVerdict => {
      if (!client) return StartOutcome.NotReady;
      if (runningRef.current) return StartOutcome.Busy;
      const config = client.getSectionConfig();
      if (!config) {
        setStatus('error');
        return StartOutcome.NotConfigured;
      }
      setRefusal(null);
      // The previous result stands until this run settles. During a run there
      // is no newer answer, and the old one is still the truth about the last
      // parameters, so clearing it here left the map blank for the length of
      // the run. A cancelled or failed run leaves it standing for the same
      // reason. The screen clears it when the area changes, which is the one
      // case where the held diff is about somewhere else.
      setProgress(null);
      const outcome = client.startPreviewDetect(lat, lng, { ...config, ...params });
      if (startOutcome(outcome) !== StartOutcome.Started) {
        // The engine's own answer, kept whole: each refusal ends differently,
        // so the screen words each one.
        setRefusal(outcome);
        setStatus('idle');
        return outcome;
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
      // the fallback poll arms. The app never cancels a run for being slow: the
      // run ends on the engine's own outcome or the athlete's cancel.
      // One ticker on a clock that drops suspended time, so a resume does not
      // read as a lapse. Before the lapse it reads nothing from the engine.
      const awake = createAwakeClock(PREVIEW_POLL_INTERVAL_MS);
      const startedAt = awake();
      let lapsedAt = false;
      tickerRef.current = setInterval(() => {
        if (!lapsedAt) {
          if (awake() - startedAt < PREVIEW_LAPSE_AFTER_MS) return;
          lapsedAt = true;
          setLapsed(true);
          return;
        }
        settle();
      }, PREVIEW_POLL_INTERVAL_MS);
      return outcome;
    },
    [client, settle, readProgress]
  );
  // Read from the end of a superseded run, which settles before start exists.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const request = useCallback(
    (lat: number, lng: number, params: PreviewParams) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (!client) return;
        if (!runningRef.current) {
          start(lat, lng, params);
          return;
        }
        // One cancel is enough however many values land while it winds down:
        // the last of them is what starts.
        if (!pendingRef.current) client.cancelPreviewDetect();
        pendingRef.current = { lat, lng, params };
        setProgress(null);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [client, start]
  );

  const cancel = useCallback(() => {
    dropRequest();
    if (!client || !runningRef.current) return;
    client.cancelPreviewDetect();
    stopRun();
    setStatus('cancelled');
    setProgress(null);
  }, [client, stopRun, dropRequest]);

  const reset = useCallback(() => {
    dropRequest();
    stopRun();
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setRefusal(null);
    setLapsed(false);
  }, [stopRun, dropRequest]);

  useEffect(() => {
    return () => {
      dropRequest();
      if (runningRef.current) client?.cancelPreviewDetect();
      stopRun();
    };
  }, [client, stopRun, dropRequest]);

  return { status, progress, result, refusal, lapsed, start, request, cancel, reset };
}

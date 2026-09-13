/**
 * Drives the route-grouping preview from the two knobs.
 *
 * The knobs move continuously and the grouping runs over the whole library, so
 * nothing starts until a value has settled. Once it has, the run is started and
 * then polled: the engine announces nothing when a grouping finishes, unlike
 * the section preview, so the status read is the only way to learn it has.
 *
 * A knob moved while a run is going cancels it. The cancel is cooperative, the
 * grouping is one engine call and cannot be interrupted, so what it buys is
 * that the stale payload is discarded rather than painted over the new one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RouteGroupPreview,
  RouteGroupingPollStatus,
  RouteGroupingPreviewClient,
} from '../../../../modules/veloqrs/src/delegates/routeGroupingPreview';
import type { GroupingParams } from '../lib/groupingParams';

/**
 * How long a knob has to stand still before the library is regrouped.
 *
 * The run is hundreds of milliseconds on a desktop at library size and is
 * unmeasured on a handset, so this is a starting value rather than a measured
 * one. It is long enough that dragging a slider across its range starts one
 * run rather than fifteen.
 */
export const GROUPING_DEBOUNCE_MS = 400;

/** How often a running preview is asked whether it has finished. */
export const GROUPING_POLL_INTERVAL_MS = 250;

/** How long a run may go before it is called failed. */
export const GROUPING_TIMEOUT_MS = 2 * 60_000;

export interface RouteGroupingPreviewState {
  status: RouteGroupingPollStatus;
  /** The payload for the settled knobs, or null until one arrives. */
  groups: RouteGroupPreview[] | null;
  /** True when a start was refused: a run already going, or nothing to group. */
  refused: boolean;
  /** Ask for a regroup at these values. Debounced. */
  request: (params: GroupingParams) => void;
  cancel: () => void;
}

export function useRouteGroupingPreview(
  client: RouteGroupingPreviewClient | null
): RouteGroupingPreviewState {
  const [status, setStatus] = useState<RouteGroupingPollStatus>('idle');
  const [groups, setGroups] = useState<RouteGroupPreview[] | null>(null);
  const [refused, setRefused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    stopPolling();
    client?.cancelRouteGroupingPreview();
    setStatus('idle');
  }, [client, stopPolling]);

  const drain = useCallback(() => {
    if (!client) return;
    const next = client.pollRouteGroupingPreview();
    if (next === 'running') {
      if (Date.now() > deadlineRef.current) {
        stopPolling();
        client.cancelRouteGroupingPreview();
        setStatus('error');
      }
      return;
    }
    stopPolling();
    setStatus(next);
    if (next === 'complete') setGroups(client.takeRouteGroupingPreviewResult() ?? []);
  }, [client, stopPolling]);

  const run = useCallback(
    (params: GroupingParams) => {
      if (!client) return;
      // A run already going is grouping at a value the athlete has moved off.
      client.cancelRouteGroupingPreview();
      const started = client.startRouteGroupingPreview(
        params.minMatchPercentage,
        params.endpointThreshold
      );
      setRefused(!started);
      if (!started) {
        setStatus('idle');
        return;
      }
      setStatus('running');
      deadlineRef.current = Date.now() + GROUPING_TIMEOUT_MS;
      stopPolling();
      pollRef.current = setInterval(drain, GROUPING_POLL_INTERVAL_MS);
    },
    [client, drain, stopPolling]
  );

  const request = useCallback(
    (params: GroupingParams) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        run(params);
      }, GROUPING_DEBOUNCE_MS);
    },
    [run]
  );

  // Leaving the screen mid-run must not leave the engine holding the slot for
  // a payload nobody will take.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      if (pollRef.current !== null) clearInterval(pollRef.current);
      client?.cancelRouteGroupingPreview();
    },
    [client]
  );

  return { status, groups, refused, request, cancel };
}

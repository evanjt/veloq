/**
 * Drives the route-grouping preview from the two knobs.
 *
 * The knobs move continuously and the grouping runs over the whole library, so
 * nothing starts until a value has settled. Once it has, the run is awaited:
 * the engine answers with a promise carrying what it grouped.
 *
 * A knob moved while a run is going cancels it. The cancel is cooperative, the
 * grouping is one engine call and cannot be interrupted, so what it buys is
 * that the stale payload is discarded rather than painted over the new one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RouteGroupPreview,
  RouteGroupingPreviewClient,
} from '../../../../modules/veloqrs/src/delegates/routeGroupingPreview';
import type { GroupingParams } from '../lib/groupingParams';
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

/**
 * How long a knob has to stand still before the library is regrouped.
 *
 * Measured on an S22 over a real 585-activity library: one run is 198 ms at
 * the strictest setting, 386 at the default and 442 at the loosest, so 400 is
 * about the length of a run rather than a guess above it. Lower and a drag
 * starts the next run before the last has finished, which buys nothing: the
 * paint cannot follow the knob more closely than the grouping can finish.
 * The 250 ms an earlier costing suggested was taken on x86, where the same
 * library groups three to four times faster.
 */
export const GROUPING_DEBOUNCE_MS = 400;

/**
 * How long a run may go before it is cancelled and said so.
 *
 * One run is 198 to 442 ms on an S22 over a real 585-activity library, the
 * measurement above, so a minute is already a hundred runs. A foreground wait
 * ends where the athlete has stopped waiting, not where the work could
 * conceivably still land.
 */
export const GROUPING_TIMEOUT_MS = 60_000;

/** What the screen shows about the run it asked for. */
export type RouteGroupingStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export interface RouteGroupingPreviewState {
  status: RouteGroupingStatus;
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
  const [status, setStatus] = useState<RouteGroupingStatus>('idle');
  const [groups, setGroups] = useState<RouteGroupPreview[] | null>(null);
  const [refused, setRefused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which run the screen is showing. A payload from a superseded run is
  // discarded rather than painted over the one the athlete is waiting for.
  const runRef = useRef(0);

  const cancel = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    runRef.current += 1;
    client?.cancelRouteGroupingPreview();
    setStatus('idle');
  }, [client]);

  const run = useCallback(
    (params: GroupingParams) => {
      if (!client) return;
      // A run already going is grouping at a value the athlete has moved off.
      client.cancelRouteGroupingPreview();
      runRef.current += 1;
      const run = runRef.current;
      setStatus('running');

      void (async () => {
        const outcome = await withAwakeDeadline(
          client.runRouteGroupingPreview(params.minMatchPercentage, params.endpointThreshold),
          GROUPING_TIMEOUT_MS
        );
        if (run !== runRef.current) return;

        // A run past the budget is cancelled and said so: the athlete has
        // stopped waiting, and the grouping cannot be interrupted mid-call.
        if (outcome.state === 'stillRunning') {
          client.cancelRouteGroupingPreview();
          setStatus('error');
          return;
        }

        setRefused(outcome.value.state === 'refused');
        switch (outcome.value.state) {
          case 'grouped':
            setGroups(outcome.value.groups);
            setStatus('complete');
            break;
          case 'cancelled':
            setStatus('cancelled');
            break;
          default:
            setStatus('idle');
        }
      })();
    },
    [client]
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

  // Leaving the screen mid-run must not leave the engine grouping for a payload
  // nobody will paint.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      client?.cancelRouteGroupingPreview();
    },
    [client]
  );

  return { status, groups, refused, request, cancel };
}

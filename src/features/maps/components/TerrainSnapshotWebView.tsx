/**
 * Hidden WebView pool that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, surface opacity: 0.01, covered by an opaque fill).
 * opacity: 0 throttles rAF on Android WebView; off-screen positioning prevents
 * WebGL compositing. opacity: 0.01 keeps both rAF and GPU rendering active.
 * Two WebView workers process snapshot requests in parallel. Each worker:
 * - Has its own generation counter for race condition protection
 * - Handles one request at a time
 * - Routes messages back via workerId
 *
 * Terrain, hillshade, sky, and route layers are added via the map API after
 * the base style loads - mirrors Map3DWebView so the first terrain drape
 * render already includes the route polyline.
 */

import React, {
  useRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  forwardRef,
  useMemo,
} from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@/shared/app';

import { veloqWebViewNativeConfig } from '@/features/maps/lib/veloqWebView';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';

import type { MapStyleType } from './mapStyles';
import {
  saveTerrainPreview,
  hasTerrainPreview,
  isTerrainPreviewDowngraded,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import { recordAppMetric } from '@/shared/debug/renderTimer';
import { pickSnapshotWorker } from '@/features/maps/lib/snapshotWorkerChoice';
import {
  SNAPSHOT_BOOT,
  SNAPSHOT_SAVE,
  SNAPSHOT_WAIT,
  recordSnapshotPhases,
  recordSnapshotTiles,
  recordSnapshotTiming,
  snapshotPageMetric,
  snapshotRenderMetric,
} from '@/features/maps/lib/snapshotTiming';
import {
  emitSnapshotComplete,
  emitSnapshotFailed,
} from '@/features/maps/lib/terrainSnapshotEvents';
import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders';
import {
  buildRenderSnapshotScript,
  type SnapshotRequest,
} from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { useWebViewBridge } from '@/features/maps/hooks/useWebViewBridge';
import type {
  WebViewBridgeHandlers,
  WebViewBridgeMessage,
} from '@/features/maps/hooks/useWebViewBridge';
import { debug } from '@/shared/debug/debug';
import {
  createSnapshotQueueTrace,
  holdShouldReport,
  publishSnapshotQueueTrace,
  unpublishSnapshotQueueShape,
} from '@/features/maps/lib/snapshotQueueTrace';

const log = debug.create('TerrainSnapshotWebView');

const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_QUEUE_SIZE = 30;
/** Failed renders held for a drain. The queue's cap, for the same reason. */
const MAX_FAILED_SIZE = 30;
const SNAPSHOT_HEIGHT = 240;
const POOL_SIZE = 2;
const MAX_SNAPSHOT_RETRIES = 1;
/** How long a retried or fallen-back render waits, to let the tile host recover. */
const RETRY_DELAY_MS = 2000;
/**
 * How long the whole pool waits after a tile server throttles it, doubling per
 * consecutive throttle up to the cap.
 *
 * A 429 or a 503 is an instruction to wait, and every worker is hitting the
 * same host, so the one request that saw it is not the thing to back off. The
 * wait is a floor the athlete cannot pull past either: a pull-to-refresh that
 * reset it would turn an impatient athlete into the load that caused it.
 */
const TILE_THROTTLE_BACKOFF_MS = 30000;
const MAX_TILE_THROTTLE_BACKOFF_MS = 300000;

/**
 * The drape, its flat stand-in and the selected flat basemap have separate
 * cameras or cache destinations. Each needs its own request even while
 * another mode for the same activity is queued or in flight.
 */
export const requestKey = (r: SnapshotRequest) =>
  `${r.activityId}_${r.mapStyle}_${r.standIn ? 's' : r.flat ? 'f' : 'd'}`;

/**
 * A queued request, with the earliest epoch millisecond it may start. Only a
 * retry and a fallback carry one, and it is on the request rather than on a
 * timer so that nothing else which runs the pool can start it early.
 */
type QueuedRequest = SnapshotRequest & { _notBefore?: number | undefined };

/**
 * Whether a request's image is filed under the drape key. A stand-in is a flat
 * image saved under the drape it stands in for, so a plain flat preview for the
 * same activity says nothing about it.
 */
const savesUnderDrape = (r: SnapshotRequest) => !r.flat || r.standIn === true;

/** Whether the cache already holds something in the slot this request fills. */
const isCached = (r: SnapshotRequest) =>
  hasTerrainPreview(r.activityId, r.mapStyle, savesUnderDrape(r));

const snapshotQueueTier = (request: SnapshotRequest): number =>
  request.priority ? 0 : request.backgroundUpgrade || request.upgrade ? 2 : 1;

/**
 * How many times a card may ask again for a render it already has a stand-in
 * for. Three is enough for a connection that comes back and few enough that a
 * host which is throttling is left alone.
 */
export const MAX_UPGRADE_ATTEMPTS = 3;

/**
 * Whether a request that only wants to replace a downgraded preview may be
 * queued, spending one of its attempts if so. A card holding a flat stand-in
 * asks again every time it mounts, so without a cap a feed that cannot draw
 * terrain re-queues every card on every scroll, firing straight back at a host
 * that is most likely throttling already. An ordinary request is never capped
 * and never counted: this gate exists only for the upgrade path.
 */
export function allowUpgradeAttempt(
  attempts: Map<string, number>,
  request: SnapshotRequest
): boolean {
  if (!request.upgrade) return true;
  const key = requestKey(request);
  const spent = attempts.get(key) ?? 0;
  if (spent >= MAX_UPGRADE_ATTEMPTS) return false;
  attempts.set(key, spent + 1);
  return true;
}

/**
 * What to do with a render that has run out of retries. A drape can still be
 * drawn as a flat basemap, which is a finished card in the athlete's own style,
 * so it falls back once instead of being filed as a failure. A flat render that
 * fails has nowhere left to go, and neither does a stand-in that has already
 * fallen back: one rung, taken once.
 */
export function fallbackRequest(
  request: SnapshotRequest,
  hasStandIn = false
): SnapshotRequest | null {
  if (request.flat || request.standIn || hasStandIn) return null;
  return {
    ...request,
    flat: true,
    standIn: true,
    firstPaint: false,
    backgroundUpgrade: false,
    upgrade: false,
    _retryAttempt: 0,
  };
}

/**
 * The downgraded renders a drape that just succeeded is evidence for. A drape
 * proves the tile host is answering for that style, and it is the only free
 * proof there is: nothing may probe the host, since a host that is throttling
 * is the likely reason these fell back in the first place. A flat render, and
 * a stand-in, say nothing about terrain and unlock nothing.
 *
 * Each card comes back at the top of the retry ladder and marked as an upgrade,
 * and goes through the same gates as a card asking for itself, so the
 * per-render cap is what bounds how often this can happen.
 */
export function upgradesUnlockedBy(
  downgraded: Map<string, SnapshotRequest>,
  completed: SnapshotRequest
): SnapshotRequest[] {
  if (completed.flat || completed.standIn) return [];
  return [...downgraded.values()]
    .filter((request) => request.mapStyle === completed.mapStyle)
    .map((request) => ({ ...request, upgrade: true, _retryAttempt: 0 }));
}

const rememberFailure = (failed: Map<string, SnapshotRequest>, req: SnapshotRequest) => {
  const key = requestKey(req);
  failed.delete(key);
  failed.set(key, { ...req, _retryAttempt: 0 });
  const oldest = failed.keys().next();
  if (failed.size > MAX_FAILED_SIZE && !oldest.done) failed.delete(oldest.value);
};

export interface TerrainSnapshotWebViewRef {
  requestSnapshot: (request: SnapshotRequest) => void;
  retryFailed: () => void;
}

interface WorkerState {
  id: number;
  webViewRef: { current: WebView | null };
  processingRef: { current: boolean };
  mapReadyRef: { current: boolean };
  /**
   * The page has loaded, so `caches` and `window._workerId` exist. Reached long
   * before `mapReadyRef`, and offline it is reached when that one never is.
   */
  documentReadyRef: { current: boolean };
  generationRef: { current: number };
  timeoutRef: { current: ReturnType<typeof setTimeout> | null };
  currentRequestRef: { current: SnapshotRequest | null };
  /**
   * Epoch milliseconds the page was handed to the WebView, for `snapshot.boot`.
   * Re-stamped on a reload, since that boot is a boot of its own.
   */
  mountedAtRef: { current: number };
  /**
   * What this worker was last asked to draw, so the pool can prefer it for a
   * render that would reuse the style it already holds. Mirrored from the
   * request rather than read back from the page, which cannot be asked.
   * Cleared whenever the WebView goes, since a fresh page holds nothing.
   */
  lastRenderRef: { current: { mapStyle: string; flat: boolean } | null };
}

interface TerrainSnapshotWebViewProps {
  /**
   * True while the feed is offscreen. The two worker WebViews come down with
   * it, because a frozen screen still holds their GL contexts and tile
   * textures. The queue survives, so a resume picks up where it stopped.
   */
  suspended?: boolean;
}

export const TerrainSnapshotWebView = forwardRef<
  TerrainSnapshotWebViewRef,
  TerrainSnapshotWebViewProps
>(function TerrainSnapshotWebView({ suspended = false }, ref) {
  const { width: screenWidth } = useWindowDimensions();
  const { colors } = useTheme();
  // Lazy-init worker pool - created once, never recreated
  const workersRef = useRef<WorkerState[] | null>(null);
  if (workersRef.current === null) {
    workersRef.current = Array.from({ length: POOL_SIZE }, (_, i) => ({
      id: i,
      webViewRef: { current: null },
      processingRef: { current: false },
      mapReadyRef: { current: false },
      documentReadyRef: { current: false },
      generationRef: { current: 0 },
      timeoutRef: { current: null },
      currentRequestRef: { current: null },
      mountedAtRef: { current: Date.now() },
      lastRenderRef: { current: null },
    }));
  }
  const workers = workersRef.current;
  const workerHtmls = useMemo(() => workers.map((w) => buildSnapshotWorkerHtml(w.id)), [workers]);

  const queueRef = useRef<QueuedRequest[]>([]);
  const queueTotalRef = useRef(0);
  const queueCompletedRef = useRef(0);
  // Keyed by render identity, so a card that re-requests a failing preview
  // replaces its entry instead of stacking another copy of its coordinates.
  // Insertion order is the drop order once it is full.
  const failedRequestsRef = useRef<Map<string, SnapshotRequest>>(new Map());
  // One silent idle retry per request, so a card whose render was dropped or
  // timed out does not wait for a pull-to-refresh it may never get.
  const idleRetriedRef = useRef(new Set<string>());
  // Attempts spent asking again for a render this card already has a stand-in
  // for, keyed by render identity. Emptied by pull-to-refresh, like the idle
  // retry set: the athlete asking is the reset.
  const upgradeAttemptsRef = useRef(new Map<string, number>());
  // Drapes that fell back to a flat stand-in, keyed by the drape's own render
  // identity. A drape rendering for any card is what brings these back.
  const downgradedRef = useRef<Map<string, SnapshotRequest>>(new Map());
  const stalenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the queue did, kept in memory because every log below is stripped from
  // a release bundle and a stall on a real device has left nothing behind
  // twice. Dumped once when the watchdog has held long enough to be wedged.
  const traceRef = useRef(createSnapshotQueueTrace());
  const consecutiveHoldsRef = useRef(0);
  // The whole pool's throttle floor, and the one timer that lifts it. Kept on
  // the pool rather than on a request because every worker shares the hosts.
  const throttledUntilRef = useRef(0);
  const throttleBackoffRef = useRef(TILE_THROTTLE_BACKOFF_MS);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One timer for the earliest retry still waiting out its delay, and when.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryWakeAtRef = useRef(0);
  // Set on unmount. A timer or a save that outlives the pool must not render,
  // and above all must not fail a card: failures are keyed by activity alone,
  // so they reach the cards of whichever pool is mounted next.
  const disposedRef = useRef(false);
  // processNext schedules itself through this, so the callback identity that
  // fires later is always the current one.
  const processNextRef = useRef<(() => void) | null>(null);
  // Read by the render loop and the watchdog, both of which run from
  // callbacks that must not be rebuilt on every focus change.
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  const STALENESS_TIMEOUT_MS = 15000;

  // Watchdog: while requests are owed a render, something must complete within
  // STALENESS_TIMEOUT_MS (in-flight renders are bounded by the per-worker
  // timeout). If a worker is mid-render, keep watching; otherwise nothing can
  // make progress (e.g. no worker ever became ready). Failing the remaining
  // requests gives each card the no-map mark, and pull-to-refresh re-queues
  // them, rather than leaving cards waiting on a preview that never comes.
  const trace = useCallback((event: Parameters<typeof traceRef.current.record>[0]) => {
    traceRef.current.record(event, Date.now());
  }, []);

  /**
   * The watchdog reaching its timeout and choosing to keep waiting. Legitimate
   * once, and the field report's own shape when it never stops.
   */
  const held = useCallback(
    (why: string) => {
      trace({ kind: 'watchdogHeld', detail: why });
      consecutiveHoldsRef.current++;
      if (holdShouldReport(consecutiveHoldsRef.current)) {
        // The one console call a release bundle keeps, per babel.config.js.
        console.error(
          traceRef.current.report(
            Date.now(),
            queueRef.current.length,
            workersRef.current?.filter((w) => w.processingRef.current).length ?? 0,
            'stalled'
          )
        );
      }
    },
    [trace]
  );

  // Readable from the debug screen on a release build, where no log reaches a
  // handset.
  useEffect(() => {
    const queueTrace = traceRef.current;
    publishSnapshotQueueTrace(queueTrace, () => ({
      queued: queueRef.current.length,
      inFlight: workersRef.current?.filter((w) => w.processingRef.current).length ?? 0,
    }));
    return () => unpublishSnapshotQueueShape(queueTrace);
  }, []);

  const armStalenessTimer = useCallback(
    function arm() {
      if (stalenessTimerRef.current) clearTimeout(stalenessTimerRef.current);
      if (suspendedRef.current || disposedRef.current) return;
      stalenessTimerRef.current = setTimeout(() => {
        stalenessTimerRef.current = null;
        if (workers.some((w) => w.processingRef.current)) {
          held('a worker is still rendering');
          arm();
          return;
        }
        // A pool waiting out a tile throttle is not a stuck pool. The backoff
        // outlasts this timeout on purpose, so keep watching rather than
        // failing every queued card for waiting as instructed.
        if (throttledUntilRef.current > Date.now()) {
          held('waiting out a tile throttle');
          arm();
          return;
        }
        consecutiveHoldsRef.current = 0;
        trace({
          kind: 'watchdogFired',
          detail: `${queueRef.current.length} failed`,
        });
        const remaining = queueRef.current.splice(0);
        for (const req of remaining) {
          rememberFailure(failedRequestsRef.current, req);
          emitSnapshotFailed(req.activityId);
        }
        queueTotalRef.current = 0;
        queueCompletedRef.current = 0;
      }, STALENESS_TIMEOUT_MS);
    },
    [workers, held, trace]
  );

  // The counts exist for the watchdog: it is armed while anything is owed a
  // render and taken off once everything counted has completed.
  const updateWatchdog = useCallback(() => {
    // Anything completing means the pool is moving, so the run of holds that
    // would have dumped the trace starts again from nothing.
    consecutiveHoldsRef.current = 0;
    if (queueTotalRef.current === 0 || queueCompletedRef.current >= queueTotalRef.current) {
      queueTotalRef.current = 0;
      queueCompletedRef.current = 0;
      if (stalenessTimerRef.current) {
        clearTimeout(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
    } else {
      armStalenessTimer();
    }
  }, [armStalenessTimer]);

  // Wakes the pool once, for the earliest retry still waiting out its delay.
  const armRetryWake = useCallback(() => {
    if (disposedRef.current) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const r of queueRef.current) {
      if (r._notBefore !== undefined && r._notBefore > now) {
        earliest = Math.min(earliest, r._notBefore);
      }
    }
    if (earliest === Infinity) return;
    if (retryTimerRef.current !== null) {
      if (retryWakeAtRef.current <= earliest) return;
      clearTimeout(retryTimerRef.current);
    }
    retryWakeAtRef.current = earliest;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      processNextRef.current?.();
    }, earliest - now);
  }, []);

  // A killed WebView renderer (Android reclaims background webview processes)
  // would otherwise leave the worker permanently dead: mapReady never re-fires,
  // queued requests wedge, and every card waiting on one waits for good. Reset
  // the worker, requeue its in-flight request, and reload - mapReady re-arms it.
  const handleWorkerGone = useCallback((worker: WorkerState) => {
    traceRef.current.record(
      {
        kind: 'workerGone',
        workerId: worker.id,
        activityId: worker.currentRequestRef.current?.activityId,
      },
      Date.now()
    );
    if (__DEV__) {
      console.warn(`[TerrainSnapshot:${worker.id}] WebView process gone - reloading`);
    }
    worker.mapReadyRef.current = false;
    worker.documentReadyRef.current = false;
    worker.processingRef.current = false;
    // A reload is a boot of its own, so `snapshot.boot` times it from here
    // rather than from whenever the pool was first built. The fresh page holds
    // no style either, so it is no longer worth preferring for one.
    worker.mountedAtRef.current = Date.now();
    worker.lastRenderRef.current = null;
    if (worker.timeoutRef.current) {
      clearTimeout(worker.timeoutRef.current);
      worker.timeoutRef.current = null;
    }
    const current = worker.currentRequestRef.current;
    worker.currentRequestRef.current = null;
    if (current) {
      queueRef.current.unshift(current);
    }
    worker.webViewRef.current?.reload();
  }, []);

  const processNext = useCallback(() => {
    if (disposedRef.current || suspendedRef.current) return;

    // A tile host asked to be left alone. Nothing is assigned until the wait
    // is out, and one timer carries it for the whole pool.
    const throttledFor = throttledUntilRef.current - Date.now();
    if (throttledFor > 0) {
      trace({ kind: 'throttled', detail: `${throttledFor}ms left` });
      if (throttleTimerRef.current === null) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          processNextRef.current?.();
        }, throttledFor);
      }
      return;
    }
    // Nothing left to render and nothing in flight: this is the moment to
    // give the failures one more go, before the pool goes quiet.
    if (
      queueRef.current.length === 0 &&
      failedRequestsRef.current.size > 0 &&
      !workers.some((w) => w.processingRef.current)
    ) {
      const failed = [...failedRequestsRef.current.values()];
      failedRequestsRef.current.clear();
      for (const req of failed) {
        const key = requestKey(req);
        // A key this drain has already spent its one retry on stays in the
        // failed map. Dropping it here is what left a card with no route
        // preview and no way back: pull-to-refresh then found nothing to
        // retry, because the drain had thrown the request away.
        if (idleRetriedRef.current.has(key)) {
          failedRequestsRef.current.set(key, req);
          continue;
        }
        // A downgrade counts as present here on purpose. This drain is the one
        // silent retry of a *failure*, and a card serving a flat stand-in has
        // not failed: flat in the athlete's own style is a finished card.
        // Upgrading one is a separate trigger's job, not this drain's.
        if (isCached(req)) continue;
        idleRetriedRef.current.add(key);
        trace({ kind: 'enqueue', activityId: req.activityId, detail: 'idle retry' });
        // Already at the ladder's last rung, so this is one more render and
        // not another round of in-flight retries.
        queueRef.current.push({
          ...req,
          _retryAttempt: MAX_SNAPSHOT_RETRIES,
          _notBefore: undefined,
        });
        queueTotalRef.current++;
      }
    }

    for (;;) {
      queueRef.current.sort((a, b) => snapshotQueueTier(a) - snapshotQueueTier(b));
      const free = workers.filter((w) => !w.processingRef.current && w.mapReadyRef.current);
      if (free.length === 0) break;

      // A retry waiting out its delay keeps its place and is passed over, so a
      // card mounting or another render finishing cannot start it early.
      const now = Date.now();
      const ready = (r: QueuedRequest) => (r._notBefore ?? 0) <= now;
      // Drain already-cached items from the front of what is ready before
      // assigning. They count as completed - otherwise the total can never be
      // reached and the watchdog stays armed over work that is done.
      let drained = 0;
      let index = queueRef.current.findIndex(ready);
      while (
        index !== -1 &&
        // An upgrade is queued knowing a stand-in is already cached, so the
        // cached check would drain it the moment it reached the front.
        !queueRef.current[index].upgrade &&
        !queueRef.current[index].backgroundUpgrade &&
        isCached(queueRef.current[index])
      ) {
        queueRef.current.splice(index, 1);
        drained++;
        index = queueRef.current.findIndex(ready);
      }
      const next = index === -1 ? undefined : queueRef.current[index];
      // Chosen for the request at the front rather than taken in pool order,
      // so a render that could reuse the style a worker already holds goes to
      // that worker. Nothing is held back for a match: with none free that
      // fits, the first free worker takes it.
      const worker =
        (next
          ? pickSnapshotWorker(
              free.map((w) => ({ worker: w, lastRender: w.lastRenderRef.current })),
              next
            )
          : null) ?? free[0];
      if (drained > 0) {
        trace({ kind: 'drain', workerId: worker.id, detail: `${drained} cached` });
        queueCompletedRef.current += drained;
        updateWatchdog();
      }
      if (!next) break;
      const request = queueRef.current.splice(index, 1)[0];

      trace({ kind: 'start', workerId: worker.id, activityId: request.activityId });
      worker.lastRenderRef.current = { mapStyle: request.mapStyle, flat: request.flat === true };
      const assignedAt = Date.now();
      recordSnapshotTiming(SNAPSHOT_WAIT, request._enqueuedAt ?? null, assignedAt);
      request._startedAt = assignedAt;
      worker.processingRef.current = true;
      worker.currentRequestRef.current = request;
      worker.generationRef.current++;
      const gen = worker.generationRef.current;
      const workerId = worker.id;

      if (__DEV__) {
        log.log(
          `[TerrainSnapshot:${workerId}] Processing ${request.activityId} gen=${gen} (style: ${request.mapStyle})`
        );
      }

      // Inject render command - builds complete style with terrain, route, and markers
      // embedded, then applies atomically via single setStyle() call.
      worker.webViewRef.current?.injectJavaScript(
        buildRenderSnapshotScript(request, workerId, gen)
      );

      // Per-worker timeout fallback
      worker.timeoutRef.current = setTimeout(() => {
        if (worker.processingRef.current) {
          trace({
            kind: 'fail',
            workerId,
            activityId: request.activityId,
            detail: `render timeout ${SNAPSHOT_TIMEOUT_MS}ms`,
          });
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${workerId}] Timeout for ${request.activityId} gen=${gen} (${SNAPSHOT_TIMEOUT_MS}ms)`
            );
          }
          worker.processingRef.current = false;
          worker.currentRequestRef.current = null;
          rememberFailure(failedRequestsRef.current, request);
          emitSnapshotFailed(request.activityId);
          queueCompletedRef.current++;
          updateWatchdog();
          processNext();
        }
      }, SNAPSHOT_TIMEOUT_MS);
    }
    armRetryWake();
  }, [workers, updateWatchdog, armRetryWake, trace]);
  processNextRef.current = processNext;

  const requestSnapshot = useCallback(
    (request: SnapshotRequest) => {
      if (disposedRef.current) return;
      // Upgrades replace a cached stand-in; other requests stop at the cache.
      if (!request.upgrade && !request.backgroundUpgrade && isCached(request)) return;
      if (queueRef.current.some((r) => requestKey(r) === requestKey(request))) return;
      if (
        (workersRef.current ?? []).some(
          (w) =>
            w.processingRef.current &&
            w.currentRequestRef.current !== null &&
            requestKey(w.currentRequestRef.current) === requestKey(request)
        )
      )
        return;

      if (!allowUpgradeAttempt(upgradeAttemptsRef.current, request)) return;
      if (queueRef.current.length >= MAX_QUEUE_SIZE) {
        const background = queueRef.current.findIndex((r) => snapshotQueueTier(r) === 2);
        if (background === -1 && snapshotQueueTier(request) === 2) return;
        const oldest =
          background === -1 ? queueRef.current.findIndex((r) => !r.priority) : background;
        const [evicted] = queueRef.current.splice(oldest === -1 ? 0 : oldest, 1);
        queueTotalRef.current--;
        // The card gets no failure event, so only the trace tells an eviction from a stall.
        traceRef.current.record(
          { kind: 'evict', activityId: evicted?.activityId, detail: 'queue full' },
          Date.now()
        );
      }
      traceRef.current.record(
        {
          kind: 'enqueue',
          activityId: request.activityId,
          detail: request.priority ? 'priority' : `queued ${queueRef.current.length}`,
        },
        Date.now()
      );
      request._enqueuedAt = Date.now();
      if (request.priority) queueRef.current.unshift(request);
      else queueRef.current.push(request);
      queueTotalRef.current++;
      updateWatchdog();
      processNext();
    },
    [processNext, updateWatchdog]
  );

  const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
    () => ({
      console: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        if (!workers[data.workerId]) return;
        if (__DEV__) log.log(`[TerrainSnapshot:JS:${data.workerId}] ${data.message}`);
      },
      mapReady: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        const worker = workers[data.workerId];
        if (!worker) return;
        if (__DEV__) log.log(`[TerrainSnapshot:${data.workerId}] WebView map ready`);
        recordSnapshotTiming(SNAPSHOT_BOOT, worker.mountedAtRef.current, Date.now());
        worker.mapReadyRef.current = true;
        processNext();
      },
      snapshot: async (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        const worker = workers[data.workerId];
        if (!worker) return;
        if (!data.activityId || !data.base64) return;

        // The worker is not holding this render any more. A timeout, a pause
        // and a lost WebView all release the worker and either count the
        // request or put it back on the queue, and the generation only moves
        // when a new request is assigned, so a worker released with nothing to
        // take next still matches the abandoned render's generation. Counting
        // it here counted it twice, which carried `completed` past `total` and
        // took the watchdog off while cards were still queued.
        if (!worker.processingRef.current) {
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Ignoring ${data.activityId}, the render was already abandoned`
            );
          }
          return;
        }

        // Discard stale snapshots from superseded requests
        if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Discarding stale snapshot for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
            );
          }
          return;
        }

        if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
        const style =
          (data.mapStyle as MapStyleType) ?? worker.currentRequestRef.current?.mapStyle ?? 'light';
        // The render is half the key, and only the request knows which one it
        // asked for: the page posts back the style, not the camera.
        const is3D = worker.currentRequestRef.current?.flat === false;
        // A stand-in is a flat image filed under the drape that was asked for,
        // so the card can tell a downgrade from a render the athlete chose.
        const standIn = worker.currentRequestRef.current?.standIn === true;
        const completed = worker.currentRequestRef.current;
        trace({
          kind: 'complete',
          workerId: data.workerId,
          activityId: data.activityId as string,
        });
        const capturedAt = Date.now();
        recordSnapshotTiming(
          snapshotRenderMetric({ flat: !is3D, standIn, firstPaint: completed?.firstPaint }),
          completed?._startedAt ?? null,
          capturedAt
        );
        if (typeof data.elapsed === 'number') {
          recordAppMetric(snapshotPageMetric(data.fastPath === true), data.elapsed);
        }
        recordSnapshotPhases(data.phases);
        recordSnapshotTiles(data.tileStats);
        worker.processingRef.current = false;
        worker.currentRequestRef.current = null;
        // A render got through, so the host is answering again and the next
        // throttle starts the ladder from its first wait.
        throttleBackoffRef.current = TILE_THROTTLE_BACKOFF_MS;
        queueCompletedRef.current++;
        updateWatchdog();
        processNext(); // Start next render immediately

        const base64 = data.base64 as string;
        const activityId = data.activityId as string;
        if (__DEV__) {
          log.log(
            `[TerrainSnapshot:${data.workerId}] Captured ${activityId} (${Math.round(base64.length / 1024)}KB base64${data.tileErrors ? `, ${data.tileErrors} tile errors` : ''})`
          );
        }
        // Save concurrently - card shows loading state until emitSnapshotComplete
        try {
          const uri = standIn
            ? await saveTerrainPreview(activityId, style, true, base64, { downgradedTo: 'flat' })
            : await saveTerrainPreview(activityId, style, is3D, base64);
          if (__DEV__) log.log(`[TerrainSnapshot:${data.workerId}] Saved ${activityId} → ${uri}`);
          emitSnapshotComplete(activityId, uri);
          // After the emit, because the card waking is the end of the stage:
          // the JPEG on disk is no use to anyone until something reads it.
          recordSnapshotTiming(SNAPSHOT_SAVE, capturedAt, Date.now());

          if (completed?.firstPaint && completed.standIn) {
            requestSnapshot({
              ...completed,
              flat: false,
              standIn: false,
              firstPaint: false,
              backgroundUpgrade: true,
              priority: false,
              upgrade: false,
              _retryAttempt: 0,
            });
          }
          if (completed) {
            downgradedRef.current.delete(requestKey(completed));
            for (const request of upgradesUnlockedBy(downgradedRef.current, completed)) {
              downgradedRef.current.delete(requestKey(request));
              requestSnapshot(request);
            }
          }
        } catch (saveErr) {
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Save failed for ${activityId}:`,
              saveErr
            );
          }
        }
      },
      snapshotError: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        const worker = workers[data.workerId];
        if (!worker) return;

        // The worker is not holding this render any more. A timeout, a pause
        // and a lost WebView all release the worker and either count the
        // request or put it back on the queue, and the generation only moves
        // when a new request is assigned, so a worker released with nothing to
        // take next still matches the abandoned render's generation. Counting
        // it here counted it twice, which carried `completed` past `total` and
        // took the watchdog off while cards were still queued.
        if (!worker.processingRef.current) {
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Ignoring ${data.activityId}, the render was already abandoned`
            );
          }
          return;
        }

        // Discard stale errors from superseded requests
        if (typeof data.gen === 'number' && data.gen !== worker.generationRef.current) {
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Discarding stale error for ${data.activityId} (gen=${data.gen}, current=${worker.generationRef.current})`
            );
          }
          return;
        }

        recordSnapshotPhases(data.phases);
        recordSnapshotTiles(data.tileStats);
        if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
        worker.processingRef.current = false;

        const currentRequest = worker.currentRequestRef.current;
        worker.currentRequestRef.current = null;
        const tileErrors = (data.tileErrors as number) ?? 0;
        const attempt = currentRequest?._retryAttempt ?? 0;

        // A throttle is the server asking for time, so the whole pool takes it
        // rather than the one request that saw it. The floor only ever moves
        // out while throttles keep arriving, and it is not reset by a retry
        // path, so nothing the athlete does shortens it.
        if (((data.tileThrottles as number) ?? 0) > 0) {
          const now = Date.now();
          if (now >= throttledUntilRef.current) {
            throttledUntilRef.current = now + throttleBackoffRef.current;
            throttleBackoffRef.current = Math.min(
              throttleBackoffRef.current * 2,
              MAX_TILE_THROTTLE_BACKOFF_MS
            );
          }
        }

        if (currentRequest && attempt < MAX_SNAPSHOT_RETRIES) {
          trace({
            kind: 'retry',
            workerId: data.workerId,
            activityId: data.activityId as string,
            detail: `attempt ${attempt + 1}, ${tileErrors} tile errors`,
          });
          // Retry: push back to front of queue with incremented attempt
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Scheduling retry for ${data.activityId} (attempt ${attempt + 1}, error: ${data.error}, tile errors: ${tileErrors})`
            );
          }
          queueRef.current.unshift({
            ...currentRequest,
            _retryAttempt: attempt + 1,
            _notBefore: Date.now() + RETRY_DELAY_MS,
          });
          armRetryWake();
        } else {
          trace({
            kind: 'fail',
            workerId: data.workerId,
            activityId: data.activityId as string,
            detail: `retries exhausted, ${tileErrors} tile errors`,
          });
          // Exhausted retries - save for later re-attempt
          if (__DEV__) {
            console.warn(
              `[TerrainSnapshot:${data.workerId}] Giving up on ${data.activityId} (error: ${data.error}, tile errors: ${tileErrors})`
            );
          }
          // The drape is out of retries but the flat basemap is still drawable,
          // so the card gets that rather than nothing. It is one more render
          // and not another round of retries, and the same delay applies: the
          // tile host is why this failed.
          const hasStandIn =
            currentRequest &&
            !currentRequest.flat &&
            isTerrainPreviewDowngraded(currentRequest.activityId, currentRequest.mapStyle, true);
          const fallback = currentRequest ? fallbackRequest(currentRequest, !!hasStandIn) : null;
          if ((fallback || hasStandIn) && currentRequest) {
            // Remembered so a later drape success can bring it back. Bounded
            // like the failed set: the oldest goes, and a card that drops out
            // still upgrades whenever it next mounts and asks for itself.
            const downgradedKey = requestKey(currentRequest);
            downgradedRef.current.delete(downgradedKey);
            downgradedRef.current.set(downgradedKey, currentRequest);
            const oldest = downgradedRef.current.keys().next();
            if (downgradedRef.current.size > MAX_FAILED_SIZE && !oldest.done) {
              downgradedRef.current.delete(oldest.value);
            }
            if (fallback) {
              queueRef.current.unshift({ ...fallback, _notBefore: Date.now() + RETRY_DELAY_MS });
              armRetryWake();
            } else {
              queueCompletedRef.current++;
              updateWatchdog();
              processNext();
            }
            return;
          }
          if (currentRequest) {
            rememberFailure(failedRequestsRef.current, currentRequest);
            emitSnapshotFailed(currentRequest.activityId);
          }
          queueCompletedRef.current++;
          updateWatchdog();
          processNext();
        }
      },
    }),
    [workers, processNext, updateWatchdog, armRetryWake, trace, requestSnapshot]
  );
  const handleMessage = useWebViewBridge(bridgeHandlers);

  // Pause the pool's work with the screen, and keep its pages. The WebViews
  // stay mounted while the feed is away, so their documents and styles survive
  // and a resume boots nothing. A worker that was mid-render may not finish
  // drawing while detached, so its request goes back to the front of the queue
  // rather than being counted as failed. A page Android reclaims meanwhile is
  // reloaded by `handleWorkerGone`, and the watchdog armed on resume covers one
  // that never comes back.
  const wasSuspendedRef = useRef(suspended);
  useEffect(() => {
    // Mount is not a resume, so only a change of state goes into the trace.
    if (suspended !== wasSuspendedRef.current) {
      wasSuspendedRef.current = suspended;
      trace({ kind: suspended ? 'suspend' : 'resume' });
    }
    if (!suspended) {
      // Re-arms the staleness timer, which the suspend cleared and which
      // nothing else would call until the next enqueue.
      updateWatchdog();
      processNext();
      return;
    }
    for (const worker of workers) {
      worker.processingRef.current = false;
      if (worker.timeoutRef.current) {
        clearTimeout(worker.timeoutRef.current);
        worker.timeoutRef.current = null;
      }
      const current = worker.currentRequestRef.current;
      worker.currentRequestRef.current = null;
      if (current) queueRef.current.unshift(current);
    }
    // A pause is neither progress nor failure, so the watchdog stops with it.
    // The counts stay on their refs, so resuming arms it again.
    if (stalenessTimerRef.current) {
      clearTimeout(stalenessTimerRef.current);
      stalenessTimerRef.current = null;
    }
  }, [suspended, workers, processNext, updateWatchdog, trace]);

  // Clear all pending timers on unmount so callbacks don't fire on a gone component
  useEffect(() => {
    // Set again on mount, since a strict-mode remount runs this cleanup first.
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      for (const worker of workers) {
        if (worker.timeoutRef.current) {
          clearTimeout(worker.timeoutRef.current);
          worker.timeoutRef.current = null;
        }
      }
      if (stalenessTimerRef.current) {
        clearTimeout(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
    };
  }, [workers]);

  useImperativeHandle(
    ref,
    () => ({
      requestSnapshot,
      retryFailed: () => {
        const failed = [...failedRequestsRef.current.values()];
        if (failed.length === 0) return;
        if (__DEV__) log.log(`[TerrainSnapshot] Retrying ${failed.length} failed snapshots`);
        failedRequestsRef.current.clear();
        // The athlete asking again is the reset for the one silent retry per
        // key, and the only thing that ever empties this set. Without it, it
        // grows a key per activity and style the pool has failed on for the
        // life of the screen.
        idleRetriedRef.current.clear();
        upgradeAttemptsRef.current.clear();
        for (const req of failed) {
          // A downgraded entry is served but is not what a drape asked for, so
          // it is re-queued rather than counted as present. It is exactly what
          // a stand-in asked for. Only a render that got what it asked for is
          // skipped.
          if (
            isCached(req) &&
            (req.standIn === true ||
              !isTerrainPreviewDowngraded(req.activityId, req.mapStyle, savesUnderDrape(req)))
          ) {
            continue;
          }
          trace({ kind: 'enqueue', activityId: req.activityId, detail: 'retry failed' });
          queueRef.current.push({ ...req, _notBefore: undefined });
          queueTotalRef.current++;
        }
        updateWatchdog();
        processNext();
      },
    }),
    [processNext, updateWatchdog, requestSnapshot, trace]
  );

  return (
    <View style={[styles.container, { width: screenWidth }]} pointerEvents="none">
      <View style={styles.surface}>
        {workers.map((worker) => (
          <WebView
            key={worker.id}
            ref={worker.webViewRef as React.RefObject<WebView>}
            source={{
              html: workerHtmls[worker.id],
              baseUrl: mapPageBaseUrl(),
            }}
            style={StyleSheet.absoluteFill}
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            androidLayerType="hardware"
            nativeConfig={veloqWebViewNativeConfig}
            onMessage={handleMessage}
            onLoadEnd={() => {
              worker.documentReadyRef.current = true;
            }}
            onRenderProcessGone={() => handleWorkerGone(worker)}
            onContentProcessDidTerminate={() => handleWorkerGone(worker)}
          />
        ))}
      </View>
      {/* The map surface stays live at near-zero opacity, which a hardware-layer WebView
          can ignore, so an opaque fill over it keeps place labels out of the feed. */}
      <View
        testID="terrain-snapshot-cover"
        style={[styles.cover, { backgroundColor: colors.background }]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: SNAPSHOT_HEIGHT,
    zIndex: -1,
  },
  surface: {
    ...StyleSheet.absoluteFill,
    opacity: 0.01,
  },
  cover: StyleSheet.absoluteFill,
});

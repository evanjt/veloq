/**
 * Hidden WebView pool that renders 3D terrain maps and captures JPEG snapshots.
 *
 * Rendered once in the feed screen, behind content (zIndex: -1, opacity: 0.01).
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

import { veloqWebViewNativeConfig } from '@/features/maps/lib/veloqWebView';

import type { MapStyleType } from './mapStyles';
import {
  saveTerrainPreview,
  hasTerrainPreview,
  isTerrainPreviewDowngraded,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import {
  emitSnapshotComplete,
  emitSnapshotFailed,
  onClearTileCache,
  onTileCacheBudget,
  onTileCacheStatsRequest,
  emitTileCacheStats,
} from '@/features/maps/lib/terrainSnapshotEvents';
import {
  applyTileCacheBudgetScript,
  clearTileCachesScript,
  tileCacheStatsScript,
} from '@/features/maps/lib/tileCacheBudget';
import {
  buildSnapshotWorkerHtml,
  buildBundledAssetReplyScript,
} from '@/features/maps/lib/htmlBuilders';
import { bundledBasemapAsset } from '@/features/maps/lib/bundledBasemap';
import { useTileCacheSettings } from '@/features/maps/lib/storage/tileCacheSettings';
import {
  buildRenderSnapshotScript,
  type SnapshotRequest,
} from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { useWebViewBridge } from '@/features/maps/hooks/useWebViewBridge';
import type {
  WebViewBridgeHandlers,
  WebViewBridgeMessage,
} from '@/features/maps/hooks/useWebViewBridge';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { debug } from '@/shared/debug/debug';
import { createSnapshotQueueTrace, holdShouldReport } from '@/features/maps/lib/snapshotQueueTrace';

const log = debug.create('TerrainSnapshotWebView');

const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_QUEUE_SIZE = 30;
/** Failed renders held for a drain. The queue's cap, for the same reason. */
const MAX_FAILED_SIZE = 30;
const SNAPSHOT_HEIGHT = 240;
const POOL_SIZE = 2;
const MAX_SNAPSHOT_RETRIES = 1;
/**
 * How long the whole pool waits after a tile server throttles it, doubling per
 * consecutive throttle up to the cap.
 *
 * A 429 or a 503 is an instruction to wait, and every worker is hitting the
 * same host, so the one request that saw it is not the thing to back off. The
 * wait is a floor the athlete cannot pull past either: a pull-to-refresh that
 * reset it would turn an impatient athlete into the load that caused it
 * (B418).
 */
const TILE_THROTTLE_BACKOFF_MS = 30000;
const MAX_TILE_THROTTLE_BACKOFF_MS = 300000;

/**
 * What makes two requests the same render. The drape and the flat basemap of
 * one activity are two images, so they key apart: dropping one because the
 * other is in flight leaves the 3D toggle with no effect at all.
 */
export const requestKey = (r: SnapshotRequest) =>
  `${r.activityId}_${r.mapStyle}_${r.flat ? 'f' : 'd'}`;

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
export function fallbackRequest(request: SnapshotRequest): SnapshotRequest | null {
  if (request.flat || request.standIn) return null;
  return { ...request, flat: true, standIn: true, _retryAttempt: 0 };
}

/**
 * The downgraded renders a drape that just succeeded is evidence for. A drape
 * proves the tile host is answering for that style, and it is the only free
 * proof there is: nothing may probe the host, since a host that is throttling
 * is the likely reason these fell back in the first place. A flat render, and
 * a stand-in, say nothing about terrain and unlock nothing.
 *
 * Each card comes back at the top of the retry ladder and marked as an upgrade,
 * so the per-render cap is what bounds how often this can happen.
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
  generationRef: { current: number };
  timeoutRef: { current: ReturnType<typeof setTimeout> | null };
  currentRequestRef: { current: SnapshotRequest | null };
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
  // Lazy-init worker pool - created once, never recreated
  const workersRef = useRef<WorkerState[] | null>(null);
  if (workersRef.current === null) {
    workersRef.current = Array.from({ length: POOL_SIZE }, (_, i) => ({
      id: i,
      webViewRef: { current: null },
      processingRef: { current: false },
      mapReadyRef: { current: false },
      generationRef: { current: 0 },
      timeoutRef: { current: null },
      currentRequestRef: { current: null },
    }));
  }
  const workers = workersRef.current;
  const tileCacheBudgetMb = useTileCacheSettings((s) => s.budgetMb);
  const workerHtmls = useMemo(
    () => workers.map((w) => buildSnapshotWorkerHtml(w.id, tileCacheBudgetMb)),
    [workers, tileCacheBudgetMb]
  );

  const queueRef = useRef<SnapshotRequest[]>([]);
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
  // processNext schedules itself through this, so the callback identity that
  // fires later is always the current one.
  const processNextRef = useRef<(() => void) | null>(null);
  // Read by the render loop and the watchdog, both of which run from
  // callbacks that must not be rebuilt on every focus change.
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  const STALENESS_TIMEOUT_MS = 15000;

  // Watchdog: whenever the pipeline is in the rendering state, an update must
  // arrive within STALENESS_TIMEOUT_MS (in-flight renders are bounded by the
  // per-worker timeout). If a worker is mid-render, keep watching; otherwise
  // nothing can make progress (e.g. no worker ever became ready), so fail the
  // remaining requests - cards fall back to the route line and pull-to-refresh
  // re-queues them - instead of leaving a stuck progress notification.
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
            workersRef.current?.filter((w) => w.processingRef.current).length ?? 0
          )
        );
      }
    },
    [trace]
  );

  const armStalenessTimer = useCallback(
    function arm() {
      if (stalenessTimerRef.current) clearTimeout(stalenessTimerRef.current);
      if (suspendedRef.current) return;
      stalenessTimerRef.current = setTimeout(() => {
        stalenessTimerRef.current = null;
        if (workers.some((w) => w.processingRef.current)) {
          held('a worker is still rendering');
          arm();
          return;
        }
        // A pool waiting out a tile throttle is not a stuck pool. The backoff
        // outlasts this timeout on purpose, so keep watching rather than
        // failing every queued card for waiting as instructed (B418).
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
        useSyncDateRange
          .getState()
          .setTerrainSnapshotProgress({ status: 'idle', completed: 0, total: 0 });
      }, STALENESS_TIMEOUT_MS);
    },
    [workers, held, trace]
  );

  const updateProgress = useCallback(() => {
    // Anything completing means the pool is moving, so the run of holds that
    // would have dumped the trace starts again from nothing.
    consecutiveHoldsRef.current = 0;
    const { setTerrainSnapshotProgress } = useSyncDateRange.getState();
    if (queueTotalRef.current === 0 || queueCompletedRef.current >= queueTotalRef.current) {
      setTerrainSnapshotProgress({ status: 'idle', completed: 0, total: 0 });
      queueTotalRef.current = 0;
      queueCompletedRef.current = 0;
      if (stalenessTimerRef.current) {
        clearTimeout(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
    } else {
      setTerrainSnapshotProgress({
        status: 'rendering',
        completed: queueCompletedRef.current,
        total: queueTotalRef.current,
      });
      armStalenessTimer();
    }
  }, [armStalenessTimer]);

  // A killed WebView renderer (Android reclaims background webview processes)
  // would otherwise leave the worker permanently dead: mapReady never re-fires,
  // queued requests wedge, and the progress notification sticks. Reset the
  // worker, requeue its in-flight request, and reload - mapReady re-arms it.
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
    worker.processingRef.current = false;
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
    if (suspendedRef.current) return;

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
        if (hasTerrainPreview(req.activityId, req.mapStyle, !req.flat)) continue;
        idleRetriedRef.current.add(key);
        // Already at the ladder's last rung, so this is one more render and
        // not another round of in-flight retries.
        queueRef.current.push({ ...req, _retryAttempt: MAX_SNAPSHOT_RETRIES });
        queueTotalRef.current++;
      }
    }

    for (const worker of workers) {
      if (worker.processingRef.current || !worker.mapReadyRef.current) continue;

      // Drain already-cached items from front of queue before assigning to this
      // worker. They count as completed - otherwise the progress total can never
      // be reached and the notification lingers at a stale count.
      let drained = 0;
      while (
        queueRef.current.length > 0 &&
        // An upgrade is queued knowing a stand-in is already cached, so the
        // cached check would drain it the moment it reached the front.
        !queueRef.current[0].upgrade &&
        hasTerrainPreview(
          queueRef.current[0].activityId,
          queueRef.current[0].mapStyle,
          !queueRef.current[0].flat
        )
      ) {
        queueRef.current.shift();
        drained++;
      }
      if (drained > 0) {
        trace({ kind: 'drain', workerId: worker.id, detail: `${drained} cached` });
        queueCompletedRef.current += drained;
        updateProgress();
      }
      const request = queueRef.current.shift();
      if (!request) {
        break;
      }

      trace({ kind: 'start', workerId: worker.id, activityId: request.activityId });
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
          updateProgress();
          processNext();
        }
      }, SNAPSHOT_TIMEOUT_MS);
    }
  }, [workers, updateProgress, trace]);
  processNextRef.current = processNext;

  // Handle messages from WebView - dispatch via shared bridge.
  // Each handler does its own worker lookup by `data.workerId` because
  // multiple worker WebViews post through the same `onMessage` callback.
  const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
    () => ({
      console: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        if (!workers[data.workerId]) return;
        if (__DEV__) log.log(`[TerrainSnapshot:JS:${data.workerId}] ${data.message}`);
      },
      bundledAssetRequest: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        const worker = workers[data.workerId];
        if (!worker) return;
        const requestId = data.requestId as string;
        const path = data.path as string;
        if (!requestId || !path) return;
        worker.webViewRef.current?.injectJavaScript(
          buildBundledAssetReplyScript(requestId, bundledBasemapAsset(path))
        );
      },
      mapReady: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        const worker = workers[data.workerId];
        if (!worker) return;
        if (__DEV__) log.log(`[TerrainSnapshot:${data.workerId}] WebView map ready`);
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
        // reported the pool done while cards were still queued.
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
        worker.processingRef.current = false;
        worker.currentRequestRef.current = null;
        queueCompletedRef.current++;
        updateProgress();
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

          // This render is the proof the host is answering, so the cards that
          // fell back to a stand-in in this style come back now.
          if (completed) {
            downgradedRef.current.delete(requestKey(completed));
            const unlocked = upgradesUnlockedBy(downgradedRef.current, completed);
            for (const request of unlocked) {
              downgradedRef.current.delete(requestKey(request));
              queueRef.current.push(request);
              queueTotalRef.current++;
            }
            if (unlocked.length > 0) {
              updateProgress();
              processNext();
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
      tileCacheStats: (data: WebViewBridgeMessage) => {
        if (typeof data.workerId !== 'number') return;
        if (!workers[data.workerId]) return;
        emitTileCacheStats({
          tileCount: (data.tileCount as number) ?? 0,
          totalBytes: (data.totalBytes as number) ?? 0,
          terrain: (data.terrain as { tileCount: number; totalBytes: number }) ?? undefined,
          vector: (data.vector as { tileCount: number; totalBytes: number }) ?? undefined,
          // The page posts three buckets and this forwarded two, so the
          // storage breakdown had no ground row however much it held.
          ground: (data.ground as { tileCount: number; totalBytes: number }) ?? undefined,
        });
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
        // reported the pool done while cards were still queued.
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

        if (worker.timeoutRef.current) clearTimeout(worker.timeoutRef.current);
        worker.processingRef.current = false;

        const currentRequest = worker.currentRequestRef.current;
        worker.currentRequestRef.current = null;
        const tileErrors = (data.tileErrors as number) ?? 0;
        const attempt = currentRequest?._retryAttempt ?? 0;

        // A throttle is the server asking for time, so the whole pool takes it
        // rather than the one request that saw it. The floor only ever moves
        // out while throttles keep arriving, and it is not reset by a retry
        // path, so nothing the athlete does shortens it (B418).
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
          });
          // Delay retry to let tile servers recover
          setTimeout(() => processNext(), 2000);
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
          const fallback = currentRequest ? fallbackRequest(currentRequest) : null;
          if (fallback && currentRequest) {
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
            queueRef.current.unshift(fallback);
            setTimeout(() => processNext(), 2000);
            return;
          }
          if (currentRequest) {
            rememberFailure(failedRequestsRef.current, currentRequest);
            emitSnapshotFailed(currentRequest.activityId);
          }
          queueCompletedRef.current++;
          updateProgress();
          processNext();
        }
      },
    }),
    [workers, processNext, updateProgress, trace]
  );
  const handleMessage = useWebViewBridge(bridgeHandlers);

  // Listen for tile cache clear events from settings
  useEffect(() => {
    return onClearTileCache(() => {
      for (const worker of workers) {
        worker.webViewRef.current?.injectJavaScript(clearTileCachesScript());
      }
    });
  }, [workers]);

  // A changed ceiling reaches the pages that are already open.
  useEffect(() => {
    return onTileCacheBudget((budgetMb) => {
      for (const worker of workers) {
        worker.webViewRef.current?.injectJavaScript(applyTileCacheBudgetScript(budgetMb));
      }
    });
  }, [workers]);

  // Listen for tile cache stats requests from settings
  useEffect(() => {
    return onTileCacheStatsRequest(() => {
      // Query worker 0 if its map is ready
      const worker = workers[0];
      if (!worker?.mapReadyRef.current || !worker.webViewRef.current) return;
      worker.webViewRef.current.injectJavaScript(tileCacheStatsScript());
    });
  }, [workers]);

  // Tear the pool down with the screen and build it back with it. A worker
  // that was mid-render loses its WebView, so its request goes back to the
  // front of the queue rather than being counted as failed.
  useEffect(() => {
    if (!suspended) {
      // The pause reported idle, so put the real count back before the pool
      // runs again. This also re-arms the staleness timer, which the suspend
      // cleared and which nothing else would call until the next enqueue.
      updateProgress();
      processNext();
      return;
    }
    for (const worker of workers) {
      worker.mapReadyRef.current = false;
      worker.processingRef.current = false;
      if (worker.timeoutRef.current) {
        clearTimeout(worker.timeoutRef.current);
        worker.timeoutRef.current = null;
      }
      const current = worker.currentRequestRef.current;
      worker.currentRequestRef.current = null;
      if (current) queueRef.current.unshift(current);
    }
    if (stalenessTimerRef.current) {
      clearTimeout(stalenessTimerRef.current);
      stalenessTimerRef.current = null;
    }
    // A pause is neither progress nor failure, and while suspended nothing
    // that could write idle can run: the timer is cleared, `processNext`
    // returns immediately and the WebViews are unmounted. So a half-done queue
    // would report `rendering` for as long as the athlete is off the feed. The
    // counts stay on their refs, so resuming reports them again.
    useSyncDateRange
      .getState()
      .setTerrainSnapshotProgress({ status: 'idle', completed: 0, total: 0 });
  }, [suspended, workers, processNext, updateProgress]);

  // Clear all pending timers on unmount so callbacks don't fire on a gone component
  useEffect(() => {
    return () => {
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
      requestSnapshot: (request: SnapshotRequest) => {
        // Deduplicate: skip if already cached, already queued, or in-flight on
        // a worker. The render is part of the identity: a 3D request that
        // arrives while the flat one for the same activity is still rendering
        // is a different image, and dropping it leaves the toggle with no
        // effect at all.
        // An upgrade request is made *because* something is cached, so the
        // cached check is the one gate it cannot be held to. The cap is what
        // bounds it instead.
        if (
          !request.upgrade &&
          hasTerrainPreview(request.activityId, request.mapStyle, !request.flat)
        ) {
          return;
        }
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

        // Drop oldest if queue is full. A dropped request never completes,
        // so it comes back off the total too: leaving it counted is what kept
        // completed from ever catching total while cards kept mounting, and
        // the progress notification posted for the whole session.
        //
        // An override is dropped last, not first: the front of the queue is
        // where it was just put, so the oldest ordinary request goes instead.
        // A card holding a downgrade asks on every mount, so the cap is what
        // keeps a feed that cannot draw terrain from re-queueing itself
        // forever.
        if (!allowUpgradeAttempt(upgradeAttemptsRef.current, request)) return;
        if (queueRef.current.length >= MAX_QUEUE_SIZE) {
          const oldest = queueRef.current.findIndex((r) => !r.priority);
          queueRef.current.splice(oldest === -1 ? 0 : oldest, 1);
          queueTotalRef.current--;
        }
        // A direct instruction about the card in front of the athlete jumps
        // every card the feed happens to have mounted (B416).
        traceRef.current.record(
          {
            kind: 'enqueue',
            activityId: request.activityId,
            detail: request.priority ? 'priority' : `queued ${queueRef.current.length}`,
          },
          Date.now()
        );
        if (request.priority) queueRef.current.unshift(request);
        else queueRef.current.push(request);
        queueTotalRef.current++;
        updateProgress();
        processNext();
      },
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
          // A downgraded entry is served but is not what was asked for, so it
          // is re-queued rather than counted as present. Only a render that got
          // what it asked for is skipped.
          if (
            hasTerrainPreview(req.activityId, req.mapStyle, !req.flat) &&
            !isTerrainPreviewDowngraded(req.activityId, req.mapStyle, !req.flat)
          ) {
            continue;
          }
          queueRef.current.push(req);
          queueTotalRef.current++;
        }
        updateProgress();
        processNext();
      },
    }),
    [processNext, updateProgress]
  );

  return (
    <View style={[styles.container, { width: screenWidth }]} pointerEvents="none">
      {(suspended ? [] : workers).map((worker) => (
        <WebView
          key={worker.id}
          ref={worker.webViewRef as React.RefObject<WebView>}
          source={{
            html: workerHtmls[worker.id],
            baseUrl: 'https://veloq.fit/',
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
          onRenderProcessGone={() => handleWorkerGone(worker)}
          onContentProcessDidTerminate={() => handleWorkerGone(worker)}
        />
      ))}
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
    opacity: 0.01,
  },
});

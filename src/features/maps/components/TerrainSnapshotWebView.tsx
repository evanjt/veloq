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
import { View, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

import type { MapStyleType } from './mapStyles';
import {
  saveTerrainPreview,
  hasTerrainPreview,
} from '@/features/maps/lib/storage/terrainPreviewCache';
import {
  emitSnapshotComplete,
  emitSnapshotFailed,
  onClearTileCache,
  onTileCacheStatsRequest,
  emitTileCacheStats,
  onPrefetchTilesRequest,
  onCancelWebViewPrefetch,
  emitPrefetchTilesProgress,
  type PrefetchTilesBatch,
} from '@/features/maps/lib/terrainSnapshotEvents';
import { generatePreloadScript } from '@/features/maps/lib/tilePreloader';
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
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_QUEUE_SIZE = 30;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SNAPSHOT_HEIGHT = 240;
const POOL_SIZE = 2;
const MAX_SNAPSHOT_RETRIES = 1;

export interface TerrainSnapshotWebViewRef {
  requestSnapshot: (request: SnapshotRequest) => void;
  retryFailed: () => void;
  preloadTiles: (script: string) => void;
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

export const TerrainSnapshotWebView = forwardRef<TerrainSnapshotWebViewRef, object>(
  function TerrainSnapshotWebView(_props, ref) {
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
    const workerHtmls = useMemo(() => workers.map((w) => buildSnapshotWorkerHtml(w.id)), [workers]);

    const queueRef = useRef<SnapshotRequest[]>([]);
    const queueTotalRef = useRef(0);
    const queueCompletedRef = useRef(0);
    const failedRequestsRef = useRef<SnapshotRequest[]>([]);
    const pendingPrefetchRef = useRef<PrefetchTilesBatch[]>([]);
    const stalenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const STALENESS_TIMEOUT_MS = 15000;

    // Watchdog: whenever the pipeline is in the rendering state, an update must
    // arrive within STALENESS_TIMEOUT_MS (in-flight renders are bounded by the
    // per-worker timeout). If a worker is mid-render, keep watching; otherwise
    // nothing can make progress (e.g. no worker ever became ready), so fail the
    // remaining requests - cards fall back to the route line and pull-to-refresh
    // re-queues them - instead of leaving a stuck progress notification.
    const armStalenessTimer = useCallback(
      function arm() {
        if (stalenessTimerRef.current) clearTimeout(stalenessTimerRef.current);
        stalenessTimerRef.current = setTimeout(() => {
          stalenessTimerRef.current = null;
          if (workers.some((w) => w.processingRef.current)) {
            arm();
            return;
          }
          const remaining = queueRef.current.splice(0);
          for (const req of remaining) {
            failedRequestsRef.current.push({ ...req, _retryAttempt: 0 });
            emitSnapshotFailed(req.activityId);
          }
          queueTotalRef.current = 0;
          queueCompletedRef.current = 0;
          useSyncDateRange
            .getState()
            .setTerrainSnapshotProgress({ status: 'idle', completed: 0, total: 0 });
        }, STALENESS_TIMEOUT_MS);
      },
      [workers]
    );

    const updateProgress = useCallback(() => {
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
    }, [workers, armStalenessTimer]);

    // A killed WebView renderer (Android reclaims background webview processes)
    // would otherwise leave the worker permanently dead: mapReady never re-fires,
    // queued requests wedge, and the progress notification sticks. Reset the
    // worker, requeue its in-flight request, and reload - mapReady re-arms it.
    const handleWorkerGone = useCallback((worker: WorkerState) => {
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
      for (const worker of workers) {
        if (worker.processingRef.current || !worker.mapReadyRef.current) continue;

        // Drain already-cached items from front of queue before assigning to this
        // worker. They count as completed - otherwise the progress total can never
        // be reached and the notification lingers at a stale count.
        let drained = 0;
        while (
          queueRef.current.length > 0 &&
          hasTerrainPreview(queueRef.current[0].activityId, queueRef.current[0].mapStyle)
        ) {
          queueRef.current.shift();
          drained++;
        }
        if (drained > 0) {
          queueCompletedRef.current += drained;
          updateProgress();
        }
        if (queueRef.current.length === 0) {
          // No more snapshots - drain any queued prefetch batches on this idle worker
          if (pendingPrefetchRef.current.length > 0 && worker.webViewRef.current) {
            worker.webViewRef.current.injectJavaScript('window._prefetchAborted = false; true;');
            const batches = pendingPrefetchRef.current.splice(0);
            for (const batch of batches) {
              worker.webViewRef.current.injectJavaScript(
                generatePreloadScript(batch.urls, batch.cacheName, batch.config)
              );
            }
          }
          break;
        }

        const request = queueRef.current.shift()!;
        worker.processingRef.current = true;
        worker.currentRequestRef.current = request;
        worker.generationRef.current++;
        const gen = worker.generationRef.current;
        const workerId = worker.id;

        if (__DEV__) {
          console.log(
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
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${workerId}] Timeout for ${request.activityId} gen=${gen} (${SNAPSHOT_TIMEOUT_MS}ms)`
              );
            }
            worker.processingRef.current = false;
            worker.currentRequestRef.current = null;
            failedRequestsRef.current.push({ ...request, _retryAttempt: 0 });
            emitSnapshotFailed(request.activityId);
            queueCompletedRef.current++;
            updateProgress();
            processNext();
          }
        }, SNAPSHOT_TIMEOUT_MS);
      }
    }, [workers, updateProgress]);

    // Handle messages from WebView - dispatch via shared bridge.
    // Each handler does its own worker lookup by `data.workerId` because
    // multiple worker WebViews post through the same `onMessage` callback.
    const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
      () => ({
        console: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          if (!workers[data.workerId]) return;
          if (__DEV__) console.log(`[TerrainSnapshot:JS:${data.workerId}] ${data.message}`);
        },
        mapReady: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;
          if (__DEV__) console.log(`[TerrainSnapshot:${data.workerId}] WebView map ready`);
          worker.mapReadyRef.current = true;
          processNext();
        },
        snapshot: async (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;
          if (!data.activityId || !data.base64) return;

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
            (data.mapStyle as MapStyleType) ??
            worker.currentRequestRef.current?.mapStyle ??
            'light';
          worker.processingRef.current = false;
          worker.currentRequestRef.current = null;
          queueCompletedRef.current++;
          updateProgress();
          processNext(); // Start next render immediately

          const base64 = data.base64 as string;
          const activityId = data.activityId as string;
          if (__DEV__) {
            console.log(
              `[TerrainSnapshot:${data.workerId}] Captured ${activityId} (${Math.round(base64.length / 1024)}KB base64${data.tileErrors ? `, ${data.tileErrors} tile errors` : ''})`
            );
          }
          // Save concurrently - card shows loading state until emitSnapshotComplete
          try {
            const uri = await saveTerrainPreview(activityId, style, base64);
            if (__DEV__)
              console.log(`[TerrainSnapshot:${data.workerId}] Saved ${activityId} → ${uri}`);
            emitSnapshotComplete(activityId, uri);
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
            satellite: (data.satellite as { tileCount: number; totalBytes: number }) ?? undefined,
            vector: (data.vector as { tileCount: number; totalBytes: number }) ?? undefined,
          });
        },
        prefetchProgress: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          if (!workers[data.workerId]) return;
          emitPrefetchTilesProgress((data.completed as number) ?? 0, (data.total as number) ?? 0);
        },
        snapshotError: (data: WebViewBridgeMessage) => {
          if (typeof data.workerId !== 'number') return;
          const worker = workers[data.workerId];
          if (!worker) return;

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

          if (currentRequest && attempt < MAX_SNAPSHOT_RETRIES) {
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
            // Exhausted retries - save for later re-attempt
            if (__DEV__) {
              console.warn(
                `[TerrainSnapshot:${data.workerId}] Giving up on ${data.activityId} (error: ${data.error}, tile errors: ${tileErrors})`
              );
            }
            if (currentRequest) {
              failedRequestsRef.current.push({
                ...currentRequest,
                _retryAttempt: 0,
              });
              emitSnapshotFailed(currentRequest.activityId);
            }
            queueCompletedRef.current++;
            updateProgress();
            processNext();
          }
        },
      }),
      [workers, processNext, updateProgress]
    );
    const handleMessage = useWebViewBridge(bridgeHandlers);

    // Listen for tile cache clear events from settings
    useEffect(() => {
      return onClearTileCache(() => {
        for (const worker of workers) {
          worker.webViewRef.current?.injectJavaScript(`
          Promise.all([
            caches.delete('veloq-terrain-dem-v1'),
            caches.delete('veloq-satellite-v1'),
            caches.delete('veloq-vector-v1'),
          ]).then(function() {
            window._rn_log('All tile caches cleared');
            window._currentBaseStyle = null;
          });
          true;
        `);
        }
      });
    }, [workers]);

    // Listen for tile cache stats requests from settings
    useEffect(() => {
      return onTileCacheStatsRequest(() => {
        // Query worker 0 if its map is ready
        const worker = workers[0];
        if (!worker?.mapReadyRef.current || !worker.webViewRef.current) return;
        worker.webViewRef.current.injectJavaScript(`
          (function() {
            var cacheNames = ['veloq-terrain-dem-v1', 'veloq-satellite-v1', 'veloq-vector-v1'];
            Promise.all(cacheNames.map(function(name) {
              return caches.open(name).then(function(cache) {
                return cache.keys().then(function(requests) {
                  return Promise.all(requests.map(function(req) {
                    return cache.match(req).then(function(r) {
                      return r ? (parseInt(r.headers.get('content-length') || '0', 10) || 0) : 0;
                    });
                  })).then(function(sizes) {
                    var total = 0;
                    for (var i = 0; i < sizes.length; i++) total += sizes[i];
                    return { name: name, tileCount: requests.length, totalBytes: total };
                  });
                });
              }).catch(function() { return { name: name, tileCount: 0, totalBytes: 0 }; });
            })).then(function(results) {
              var combined = { tileCount: 0, totalBytes: 0, terrain: null, satellite: null, vector: null };
              results.forEach(function(r) {
                combined.tileCount += r.tileCount;
                combined.totalBytes += r.totalBytes;
                if (r.name.indexOf('terrain') >= 0) combined.terrain = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                else if (r.name.indexOf('satellite') >= 0) combined.satellite = { tileCount: r.tileCount, totalBytes: r.totalBytes };
                else if (r.name.indexOf('vector') >= 0) combined.vector = { tileCount: r.tileCount, totalBytes: r.totalBytes };
              });
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'tileCacheStats', workerId: window._workerId,
                tileCount: combined.tileCount, totalBytes: combined.totalBytes,
                terrain: combined.terrain, satellite: combined.satellite, vector: combined.vector,
              }));
            });
          })();
          true;
        `);
      });
    }, [workers]);

    // Listen for prefetch tile requests from TileCacheService
    useEffect(() => {
      return onPrefetchTilesRequest((batches: PrefetchTilesBatch[]) => {
        // Find an idle worker to run the prefetch
        const worker = workers.find((w) => w.mapReadyRef.current && !w.processingRef.current);
        if (!worker?.webViewRef.current) {
          // All workers busy - queue for later execution when snapshots finish
          pendingPrefetchRef.current.push(...batches);
          return;
        }

        // Reset abort flag before starting new prefetch
        worker.webViewRef.current.injectJavaScript('window._prefetchAborted = false; true;');

        for (const batch of batches) {
          const script = generatePreloadScript(batch.urls, batch.cacheName, batch.config);
          worker.webViewRef.current.injectJavaScript(script);
        }
      });
    }, [workers]);

    // Listen for cancel events - set abort flag in all workers
    useEffect(() => {
      return onCancelWebViewPrefetch(() => {
        for (const worker of workers) {
          if (worker.webViewRef.current && worker.mapReadyRef.current) {
            worker.webViewRef.current.injectJavaScript('window._prefetchAborted = true; true;');
          }
        }
        pendingPrefetchRef.current = [];
      });
    }, [workers]);

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
          // Deduplicate: skip if already cached, already queued, or in-flight on a worker
          if (hasTerrainPreview(request.activityId, request.mapStyle)) return;
          if (
            queueRef.current.some(
              (r) => r.activityId === request.activityId && r.mapStyle === request.mapStyle
            )
          )
            return;
          if (
            workers.some(
              (w) =>
                w.processingRef.current &&
                w.currentRequestRef.current?.activityId === request.activityId &&
                w.currentRequestRef.current?.mapStyle === request.mapStyle
            )
          )
            return;

          // Drop oldest if queue is full
          if (queueRef.current.length >= MAX_QUEUE_SIZE) {
            queueRef.current.shift();
          }
          queueRef.current.push(request);
          queueTotalRef.current++;
          updateProgress();
          processNext();
        },
        retryFailed: () => {
          const failed = failedRequestsRef.current;
          if (failed.length === 0) return;
          if (__DEV__) console.log(`[TerrainSnapshot] Retrying ${failed.length} failed snapshots`);
          failedRequestsRef.current = [];
          for (const req of failed) {
            if (hasTerrainPreview(req.activityId, req.mapStyle)) continue;
            queueRef.current.push(req);
            queueTotalRef.current++;
          }
          updateProgress();
          processNext();
        },
        preloadTiles: (script: string) => {
          // Find an idle worker to run the preload script
          const worker = workers.find((w) => w.mapReadyRef.current && !w.processingRef.current);
          if (worker?.webViewRef.current) {
            worker.webViewRef.current.injectJavaScript(script);
          }
        },
      }),
      [processNext, updateProgress]
    );

    return (
      <View style={styles.container} pointerEvents="none">
        {workers.map((worker) => (
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
            onMessage={handleMessage}
            onRenderProcessGone={() => handleWorkerGone(worker)}
            onContentProcessDidTerminate={() => handleWorkerGone(worker)}
          />
        ))}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_WIDTH,
    height: SNAPSHOT_HEIGHT,
    zIndex: -1,
    opacity: 0.01,
  },
});

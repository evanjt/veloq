/**
 * The 2D map surface. One MapLibre GL JS page in a WebView, driven by
 * declarative source, layer and marker specs.
 *
 * Callers describe what should be on the map and MapSurface works out the
 * minimum patch to send. Only sources whose data actually changed cross the
 * bridge; layer specs are small enough to send in full so their order stays
 * authoritative.
 *
 * Everything that used to need a platform branch - hit testing, cluster
 * expansion, feature queries - happens inside the page and comes back as a
 * resolved answer.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { darkColors, spacing, typography } from '@/theme';
import { ComponentErrorBoundary } from '@/shared/ui';
import { debug } from '@/shared/debug/debug';
import { HEATMAP_TILES_DIR } from '@/features/maps/hooks/useHeatmapTiles';
import { useWebViewBridge } from '@/features/maps/hooks/useWebViewBridge';
import type {
  WebViewBridgeHandlers,
  WebViewBridgeMessage,
} from '@/features/maps/hooks/useWebViewBridge';
import { REGION_CHANGE_DEBOUNCE_MS } from '@/features/maps/lib/mapBudgets';
import type { LngLat, LngLatBounds } from '@/features/maps/lib/coordinates';
import {
  buildApplyScript,
  buildClusterExpansionZoomScript,
  buildClusterLeavesScript,
  buildFitBoundsScript,
  buildHeatmapTileReplyScript,
  buildMapSurfaceHtml,
  buildProjectPointsScript,
  buildQueryFeaturesScript,
  buildQueryViewportFeaturesScript,
  buildResetOrientationScript,
  buildSetCameraScript,
  buildSetStyleScript,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import type {
  MapCameraSpec,
  MapImageSpec,
  MapLayerSpec,
  MapMarkerSpec,
  MapPadding,
  MapSourceSpec,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import type { WebViewStyleOptions } from '@/features/maps/lib/htmlBuilders/styleResolution';
import type { MapStyleType } from './mapStyles';

const log = debug.create('MapSurface');

/**
 * Shared testID for the map surface. Callers override it only when two
 * surfaces are mounted at once.
 */
export const MAP_SURFACE_TEST_ID = 'maplibre-map';

/** The state shown when the page cannot draw a basemap at all. */
export const MAP_SURFACE_UNAVAILABLE_TEST_ID = 'map-unavailable';

/** Long-press duration, matching the platform default for a press-and-hold. */
const LONG_PRESS_MS = 500;

export interface MapCameraState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
  bounds: LngLatBounds;
}

export interface MapFeatureHit {
  layerId: string | null;
  id: string | number | null;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry | null;
  /** Screen position of a point feature, present on viewport queries. */
  screen?: { x: number; y: number } | null;
}

export interface MapPressEvent {
  coordinate: LngLat;
  point: [number, number];
  feature: MapFeatureHit | null;
}

export interface MapSurfaceRef {
  fitBounds: (bounds: LngLatBounds, padding?: MapPadding, duration?: number) => void;
  setCamera: (camera: MapCameraSpec, duration?: number) => void;
  resetOrientation: () => void;
  queryFeatures: (
    point: [number, number],
    layers: string[],
    radius?: number
  ) => Promise<MapFeatureHit[]>;
  /** Everything drawn in these layers right now, with screen positions. */
  queryViewportFeatures: (layers: string[]) => Promise<MapFeatureHit[]>;
  getClusterLeaves: (
    sourceId: string,
    clusterId: number,
    limit?: number,
    offset?: number
  ) => Promise<GeoJSON.Feature[]>;
  getClusterExpansionZoom: (sourceId: string, clusterId: number) => Promise<number | null>;
  projectPoints: (
    points: { id: string; coordinate: LngLat }[]
  ) => Promise<{ id: string; x: number; y: number }[]>;
}

export interface MapSurfaceProps {
  /** Base style. Changes apply through `setStyle`, never a page reload. */
  mapStyle: MapStyleType;
  styleOptions?: WebViewStyleOptions;
  /** Camera for first paint. Later moves go through the ref. */
  initialCamera: MapCameraSpec;
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  markers?: MapMarkerSpec[];
  images?: MapImageSpec[];
  /** Layers hit-tested on tap, most specific first. */
  interactiveLayers?: string[];
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  /** Serve heatmap PNG tiles from the device for the `heatmap-file` protocol. */
  serveHeatmapTiles?: boolean;
  onMapReady?: () => void;
  /** The page cannot render a basemap. Fires once per failure, with the reason. */
  onMapFailed?: (reason: string) => void;
  onPress?: (event: MapPressEvent) => void;
  onLongPress?: (event: MapPressEvent) => void;
  onRegionIsChanging?: (state: MapCameraState, isUserInteraction: boolean) => void;
  onRegionDidChange?: (state: MapCameraState, isUserInteraction: boolean) => void;
  onBearingChange?: (bearing: number) => void;
  testID?: string;
}

type PendingResolver = (value: unknown) => void;

function toCameraState(data: WebViewBridgeMessage): MapCameraState | null {
  const center = data.center as LngLat | undefined;
  const bounds = data.bounds as LngLatBounds | undefined;
  if (!center || !bounds) return null;
  return {
    center,
    zoom: data.zoom as number,
    bearing: data.bearing as number,
    pitch: data.pitch as number,
    bounds,
  };
}

function toPressEvent(data: WebViewBridgeMessage): MapPressEvent | null {
  const coordinate = data.coordinate as LngLat | undefined;
  if (!coordinate) return null;
  return {
    coordinate,
    point: (data.point as [number, number]) ?? [0, 0],
    feature: (data.feature as MapFeatureHit | null) ?? null,
  };
}

export const MapSurface = forwardRef<MapSurfaceRef, MapSurfaceProps>(function MapSurface(
  {
    mapStyle,
    styleOptions,
    initialCamera,
    sources,
    layers,
    markers,
    images,
    interactiveLayers,
    scrollEnabled = true,
    zoomEnabled = true,
    rotateEnabled = true,
    pitchEnabled = false,
    serveHeatmapTiles = false,
    onMapReady,
    onMapFailed,
    onPress,
    onLongPress,
    onRegionIsChanging,
    onRegionDidChange,
    onBearingChange,
    testID = MAP_SURFACE_TEST_ID,
  },
  ref
) {
  const { t } = useTranslation();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const failedRef = useRef(false);
  const [unavailable, setUnavailable] = useState(false);

  // Last spec actually sent, so a re-render only ships what moved.
  const sentSourcesRef = useRef<Record<string, string>>({});
  const sentLayersRef = useRef<string>('');
  const sentMarkersRef = useRef<string>('');
  const sentImagesRef = useRef<string>('');

  const pendingRef = useRef(new Map<string, PendingResolver>());
  const requestSeqRef = useRef(0);

  // Callbacks live in refs so the bridge handler map stays stable.
  const callbacksRef = useRef({
    onMapReady,
    onMapFailed,
    onPress,
    onLongPress,
    onRegionIsChanging,
    onRegionDidChange,
    onBearingChange,
  });
  callbacksRef.current = {
    onMapReady,
    onMapFailed,
    onPress,
    onLongPress,
    onRegionIsChanging,
    onRegionDidChange,
    onBearingChange,
  };

  // The page is rebuilt only for gesture settings, never for data or style.
  const initialCameraRef = useRef(initialCamera);
  const initialStyleRef = useRef(mapStyle);
  const renderedStyleRef = useRef(mapStyle);

  const html = useMemo(
    () =>
      buildMapSurfaceHtml({
        style: initialStyleRef.current,
        styleOptions,
        camera: initialCameraRef.current,
        interaction: {
          scroll: scrollEnabled,
          zoom: zoomEnabled,
          rotate: rotateEnabled,
          pitch: pitchEnabled,
        },
        devicePixelRatio: Math.min(PixelRatio.get(), 2),
        regionChangeThrottleMs: REGION_CHANGE_DEBOUNCE_MS,
        longPressMs: LONG_PRESS_MS,
      }),
    // styleOptions is a plain settings object supplied as a literal by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollEnabled, zoomEnabled, rotateEnabled, pitchEnabled]
  );

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const sendPatch = useCallback(() => {
    // Injection before `load` is dropped on the floor, so hold everything back
    // until the page says it is ready and send the whole spec then.
    if (!readyRef.current) return;

    const changedSources: Record<string, MapSourceSpec | null> = {};
    let hasSourceChange = false;

    for (const [id, spec] of Object.entries(sources)) {
      const serialised = JSON.stringify(spec);
      if (sentSourcesRef.current[id] !== serialised) {
        changedSources[id] = spec;
        sentSourcesRef.current[id] = serialised;
        hasSourceChange = true;
      }
    }
    for (const id of Object.keys(sentSourcesRef.current)) {
      if (!(id in sources)) {
        changedSources[id] = null;
        delete sentSourcesRef.current[id];
        hasSourceChange = true;
      }
    }

    const layersJSON = JSON.stringify(layers);
    const layersChanged = layersJSON !== sentLayersRef.current;
    sentLayersRef.current = layersJSON;

    const markersJSON = JSON.stringify(markers ?? []);
    const markersChanged = markersJSON !== sentMarkersRef.current;
    sentMarkersRef.current = markersJSON;

    const imagesJSON = JSON.stringify(images ?? []);
    const imagesChanged = imagesJSON !== sentImagesRef.current;
    sentImagesRef.current = imagesJSON;

    if (!hasSourceChange && !layersChanged && !markersChanged && !imagesChanged) return;

    inject(
      buildApplyScript({
        ...(imagesChanged || images ? { images: images ?? [] } : {}),
        ...(hasSourceChange ? { sources: changedSources } : {}),
        ...(layersChanged ? { layers } : {}),
        ...(markersChanged ? { markers: markers ?? [] } : {}),
        ...(interactiveLayers ? { interactiveLayers } : {}),
      })
    );
  }, [sources, layers, markers, images, interactiveLayers, inject]);

  // The bridge handlers are built once, so they reach the current patch sender
  // through a ref rather than a dependency.
  const sendPatchRef = useRef(sendPatch);
  sendPatchRef.current = sendPatch;

  // The page reports its own failure, and the WebView reports the ones the page
  // never got far enough to see. Either way the surface says so once, until a
  // load arrives and clears it.
  const reportFailure = useCallback((reason: string) => {
    if (failedRef.current) return;
    failedRef.current = true;
    setUnavailable(true);
    log.log(`basemap unavailable: ${reason}`);
    callbacksRef.current.onMapFailed?.(reason);
  }, []);

  const resolvePending = useCallback((requestId: string, value: unknown) => {
    const resolver = pendingRef.current.get(requestId);
    if (!resolver) return;
    pendingRef.current.delete(requestId);
    resolver(value);
  }, []);

  const request = useCallback(
    <T,>(build: (requestId: string) => string): Promise<T> => {
      requestSeqRef.current += 1;
      const requestId = `req_${requestSeqRef.current}`;
      return new Promise<T>((resolve) => {
        pendingRef.current.set(requestId, resolve as PendingResolver);
        inject(build(requestId));
      });
    },
    [inject]
  );

  const handlers = useMemo<WebViewBridgeHandlers>(
    () => ({
      console: (data) => log.log(data.message),
      mapReady: () => {
        readyRef.current = true;
        failedRef.current = false;
        setUnavailable(false);
        sentSourcesRef.current = {};
        sentLayersRef.current = '';
        sentMarkersRef.current = '';
        sentImagesRef.current = '';
        sendPatchRef.current();
        callbacksRef.current.onMapReady?.();
      },
      mapFailed: (data) => {
        reportFailure(String(data.reason ?? 'unknown'));
      },
      mapClick: (data) => {
        const event = toPressEvent(data);
        if (event) callbacksRef.current.onPress?.(event);
      },
      mapLongPress: (data) => {
        const event = toPressEvent(data);
        if (event) callbacksRef.current.onLongPress?.(event);
      },
      regionIsChanging: (data) => {
        const state = toCameraState(data);
        if (state) {
          callbacksRef.current.onRegionIsChanging?.(state, data.isUserInteraction === true);
        }
      },
      regionDidChange: (data) => {
        const state = toCameraState(data);
        if (state) {
          callbacksRef.current.onRegionDidChange?.(state, data.isUserInteraction === true);
        }
      },
      bearingChange: (data) => {
        if (typeof data.bearing === 'number') callbacksRef.current.onBearingChange?.(data.bearing);
      },
      queryResult: (data) => resolvePending(data.requestId as string, data.features ?? []),
      clusterLeaves: (data) => resolvePending(data.requestId as string, data.features ?? []),
      clusterExpansionZoom: (data) => resolvePending(data.requestId as string, data.zoom ?? null),
      projected: (data) => resolvePending(data.requestId as string, data.points ?? []),
      heatmapTileRequest: async (data) => {
        const requestId = data.requestId as string;
        const tilePath = data.tilePath as string;
        if (!requestId || !tilePath) return;
        if (!serveHeatmapTiles) {
          inject(buildHeatmapTileReplyScript(requestId, null));
          return;
        }
        try {
          const fullPath = `${HEATMAP_TILES_DIR}${tilePath}`;
          const info = await FileSystem.getInfoAsync(fullPath);
          const base64 =
            info.exists && info.size > 0
              ? await FileSystem.readAsStringAsync(fullPath, {
                  encoding: FileSystem.EncodingType.Base64,
                })
              : null;
          inject(buildHeatmapTileReplyScript(requestId, base64));
        } catch {
          inject(buildHeatmapTileReplyScript(requestId, null));
        }
      },
    }),
    [inject, reportFailure, resolvePending, serveHeatmapTiles]
  );

  const handleMessage = useWebViewBridge(handlers);

  useEffect(() => {
    sendPatch();
  }, [sendPatch]);

  // Style swaps happen in place. The page replays its cached spec afterwards,
  // so no geometry crosses the bridge a second time.
  useEffect(() => {
    if (mapStyle === renderedStyleRef.current) return;
    renderedStyleRef.current = mapStyle;
    inject(buildSetStyleScript(mapStyle, styleOptions));
    // styleOptions is a settings literal; the style type is what drives the swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle, inject]);

  useImperativeHandle(
    ref,
    () => ({
      fitBounds: (bounds, padding, duration) => {
        inject(buildFitBoundsScript(bounds, padding, duration));
      },
      setCamera: (camera, duration) => {
        inject(buildSetCameraScript(camera, duration));
      },
      resetOrientation: () => {
        inject(buildResetOrientationScript());
      },
      queryFeatures: (point, queryLayers, radius) =>
        request<MapFeatureHit[]>((requestId) =>
          buildQueryFeaturesScript(requestId, point, queryLayers, radius)
        ),
      queryViewportFeatures: (queryLayers) =>
        request<MapFeatureHit[]>((requestId) =>
          buildQueryViewportFeaturesScript(requestId, queryLayers)
        ),
      getClusterLeaves: (sourceId, clusterId, limit = 100, offset = 0) =>
        request<GeoJSON.Feature[]>((requestId) =>
          buildClusterLeavesScript(requestId, sourceId, clusterId, limit, offset)
        ),
      getClusterExpansionZoom: (sourceId, clusterId) =>
        request<number | null>((requestId) =>
          buildClusterExpansionZoomScript(requestId, sourceId, clusterId)
        ),
      projectPoints: (points) =>
        request<{ id: string; x: number; y: number }[]>((requestId) =>
          buildProjectPointsScript(requestId, points)
        ),
    }),
    [inject, request]
  );

  // A crashed render process comes back empty, so everything has to resend.
  const handleCrash = useCallback(() => {
    readyRef.current = false;
    sentSourcesRef.current = {};
    sentLayersRef.current = '';
    sentMarkersRef.current = '';
    sentImagesRef.current = '';
    webViewRef.current?.reload();
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      readyRef.current = false;
      pending.clear();
      webViewRef.current?.stopLoading();
    };
  }, []);

  return (
    <ComponentErrorBoundary componentName="Map" showRetry={false}>
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          testID={testID}
          source={{ html, baseUrl: 'https://veloq.fit/' }}
          style={styles.webview}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          originWhitelist={['*']}
          mixedContentMode="always"
          androidLayerType="hardware"
          onMessage={handleMessage}
          onContentProcessDidTerminate={handleCrash}
          onRenderProcessGone={handleCrash}
          onError={(event) => reportFailure(event.nativeEvent?.description ?? 'webview load error')}
          onHttpError={(event) => reportFailure(`HTTP ${event.nativeEvent?.statusCode ?? '?'}`)}
        />
        {unavailable && (
          <View style={styles.unavailable} testID={MAP_SURFACE_UNAVAILABLE_TEST_ID}>
            <MaterialCommunityIcons
              name="map-marker-off-outline"
              size={40}
              color={darkColors.textSecondary}
            />
            <Text style={styles.unavailableTitle}>{t('maps.unavailableTitle')}</Text>
            <Text style={styles.unavailableHint}>{t('maps.unavailableHint')}</Text>
          </View>
        )}
      </View>
    </ComponentErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  unavailable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: darkColors.background,
  },
  unavailableTitle: {
    ...typography.cardTitle,
    color: darkColors.textPrimary,
    marginTop: spacing.sm,
  },
  unavailableHint: {
    ...typography.bodySmall,
    color: darkColors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});

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
import { ActivityIndicator, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { veloqWebViewNativeConfig } from '@/features/maps/lib/veloqWebView';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { darkColors, spacing, typography } from '@/theme';
import { ComponentErrorBoundary } from '@/shared/ui';
import { debug } from '@/shared/debug/debug';
import { useWebViewBridge } from '@/features/maps/hooks/useWebViewBridge';
import type {
  WebViewBridgeHandlers,
  WebViewBridgeMessage,
} from '@/features/maps/hooks/useWebViewBridge';
import {
  REGION_CHANGE_DEBOUNCE_MS,
  TILE_LOADING_INDICATOR_DELAY_MS,
} from '@/features/maps/lib/mapBudgets';
import { createTileLoadingGate } from '@/features/maps/lib/tileLoadingGate';
import type { LngLat, LngLatBounds } from '@/features/maps/lib/coordinates';
import {
  buildApplyScript,
  buildClusterExpansionZoomScript,
  buildClusterLeavesScript,
  buildFitBoundsScript,
  buildMapSurfaceHtml,
  buildProjectPointsScript,
  buildQueryFeaturesScript,
  buildQueryViewportFeaturesScript,
  buildResetOrientationScript,
  buildSetCameraScript,
  buildSetStyleScript,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import { buildReleaseMapScript } from '@/features/maps/lib/htmlBuilders/shared';
import { createSurfacePatcher } from '@/features/maps/lib/mapSurfacePatch';
import { createPendingRequests } from '@/features/maps/lib/pendingRequests';
import { registerReleasableSurface } from '@/features/maps/lib/mapSurfaceRegistry';
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
import {} from '@/features/maps/lib/terrainSnapshotEvents';

const log = debug.create('MapSurface');

/**
 * Shared testID for the map surface. Callers override it only when two
 * surfaces are mounted at once.
 */
export const MAP_SURFACE_TEST_ID = 'maplibre-map';

/** The state shown when the page cannot draw a basemap at all. */
export const MAP_SURFACE_UNAVAILABLE_TEST_ID = 'map-unavailable';
export const MAP_SURFACE_TILES_LOADING_TEST_ID = 'map-tiles-loading';

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
  /** Every hit in the layer that won the tap, `feature` first. */
  features?: MapFeatureHit[] | undefined;
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
  styleOptions?: WebViewStyleOptions | undefined;
  /** Camera for first paint. Later moves go through the ref. */
  initialCamera: MapCameraSpec;
  sources: Record<string, MapSourceSpec>;
  layers: MapLayerSpec[];
  markers?: MapMarkerSpec[] | undefined;
  images?: MapImageSpec[] | undefined;
  /** Layers hit-tested on tap, most specific first. */
  interactiveLayers?: string[] | undefined;
  scrollEnabled?: boolean | undefined;
  zoomEnabled?: boolean | undefined;
  rotateEnabled?: boolean | undefined;
  pitchEnabled?: boolean | undefined;
  onMapReady?: (() => void) | undefined;
  /** The page cannot render a basemap. Fires once per failure, with the reason. */
  onMapFailed?: ((reason: string) => void) | undefined;
  onPress?: ((event: MapPressEvent) => void) | undefined;
  onLongPress?: ((event: MapPressEvent) => void) | undefined;
  onRegionIsChanging?: ((state: MapCameraState, isUserInteraction: boolean) => void) | undefined;
  onRegionDidChange?: ((state: MapCameraState, isUserInteraction: boolean) => void) | undefined;
  onBearingChange?: ((bearing: number) => void) | undefined;
  testID?: string | undefined;
}

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
    features: (data.features as MapFeatureHit[] | undefined) ?? [],
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
  const [tilesLoading, setTilesLoading] = useState(false);
  const tileGateRef = useRef(
    createTileLoadingGate(TILE_LOADING_INDICATOR_DELAY_MS, setTilesLoading)
  );

  // What the page has been told, so a re-render only ships what moved.
  const patcherRef = useRef(createSurfacePatcher());

  const pendingRef = useRef(createPendingRequests());

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
  // What the page is showing. A rebuilt page starts from `initialStyleRef`.
  const renderedStyleRef = useRef(mapStyle);
  const shownStyleRef = useRef(mapStyle);
  shownStyleRef.current = mapStyle;
  const styleOptionsRef = useRef(styleOptions);
  styleOptionsRef.current = styleOptions;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The settings object is reconstructed by callers.
    [scrollEnabled, zoomEnabled, rotateEnabled, pitchEnabled]
  );

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const sendPatch = useCallback(() => {
    // Injection before `load` is dropped on the floor, so hold everything back
    // until the page says it is ready and send the whole spec then.
    if (!readyRef.current) return;

    const { patch } = patcherRef.current.next({
      sources,
      layers,
      markers,
      images,
      interactiveLayers,
    });
    if (!patch) return;

    inject(buildApplyScript(patch));
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
    pendingRef.current.settle(requestId, value);
  }, []);

  // The empty answer each caller passes is what it is handed if the page goes
  // away before it replies, so nothing waits on a promise that cannot settle.
  const request = useCallback(
    <T,>(empty: T, build: (requestId: string) => string): Promise<T> =>
      pendingRef.current.open<T>(empty, (requestId) => inject(build(requestId))),
    [inject]
  );

  const handlers = useMemo<WebViewBridgeHandlers>(
    () => ({
      console: (data) => log.log(data.message),
      mapReady: () => {
        readyRef.current = true;
        failedRef.current = false;
        setUnavailable(false);
        tileGateRef.current.settled();
        patcherRef.current.forget();
        // A rebuilt page comes up in the first style, and a toggle made before
        // it was ready had nowhere to go, so catch it up to what is shown.
        renderedStyleRef.current = initialStyleRef.current;
        if (shownStyleRef.current !== renderedStyleRef.current) {
          renderedStyleRef.current = shownStyleRef.current;
          inject(buildSetStyleScript(shownStyleRef.current, styleOptionsRef.current));
        }
        sendPatchRef.current();
        callbacksRef.current.onMapReady?.();
      },
      mapFailed: (data) => {
        reportFailure(String(data.reason ?? 'unknown'));
      },
      tilesLoading: () => tileGateRef.current.loading(),
      tilesSettled: () => tileGateRef.current.settled(),
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
    }),
    [inject, reportFailure, resolvePending]
  );

  const handleMessage = useWebViewBridge(handlers);

  useEffect(() => {
    sendPatch();
  }, [sendPatch]);

  // Style swaps happen in place. The page replays its cached spec afterwards,
  // so no geometry crosses the bridge a second time.
  useEffect(() => {
    if (!readyRef.current || mapStyle === renderedStyleRef.current) return;
    renderedStyleRef.current = mapStyle;
    inject(buildSetStyleScript(mapStyle, styleOptions));
    // styleOptions is a settings literal; the style type is what drives the swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The map style drives this update, and options are a settings literal.
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
        request<MapFeatureHit[]>([], (requestId) =>
          buildQueryFeaturesScript(requestId, point, queryLayers, radius)
        ),
      queryViewportFeatures: (queryLayers) =>
        request<MapFeatureHit[]>([], (requestId) =>
          buildQueryViewportFeaturesScript(requestId, queryLayers)
        ),
      getClusterLeaves: (sourceId, clusterId, limit = 100, offset = 0) =>
        request<GeoJSON.Feature[]>([], (requestId) =>
          buildClusterLeavesScript(requestId, sourceId, clusterId, limit, offset)
        ),
      getClusterExpansionZoom: (sourceId, clusterId) =>
        request<number | null>(null, (requestId) =>
          buildClusterExpansionZoomScript(requestId, sourceId, clusterId)
        ),
      projectPoints: (points) =>
        request<{ id: string; x: number; y: number }[]>([], (requestId) =>
          buildProjectPointsScript(requestId, points)
        ),
    }),
    [inject, request]
  );

  // A crashed render process comes back empty, so everything has to resend.
  const handleCrash = useCallback(() => {
    readyRef.current = false;
    tileGateRef.current.settled();
    patcherRef.current.forget();
    pendingRef.current.abandon();
    webViewRef.current?.reload();
  }, []);

  // A surface the reclaimer releases holds no map until the reload, so the
  // patch sender is silenced the same way a crash silences it.
  useEffect(
    () =>
      registerReleasableSurface({
        release: () => {
          readyRef.current = false;
          pendingRef.current.abandon();
          inject(buildReleaseMapScript());
        },
        rebuild: handleCrash,
      }),
    [inject, handleCrash]
  );

  useEffect(() => {
    const pending = pendingRef.current;
    // Both captured on mount. React detaches the ref before this cleanup runs,
    // so reading `webViewRef.current` here finds null and the page goes on
    // loading after the surface is gone.
    const webView = webViewRef.current;
    const tileGate = tileGateRef.current;
    return () => {
      readyRef.current = false;
      tileGate.cancel();
      pending.abandon();
      webView?.stopLoading();
    };
  }, []);

  return (
    <ComponentErrorBoundary componentName="Map" showRetry={false}>
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          testID={testID}
          source={{ html, baseUrl: mapPageBaseUrl() }}
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
          nativeConfig={veloqWebViewNativeConfig}
          onMessage={handleMessage}
          onContentProcessDidTerminate={handleCrash}
          onRenderProcessGone={handleCrash}
          onError={(event) => reportFailure(event.nativeEvent?.description ?? 'webview load error')}
          onHttpError={(event) => reportFailure(`HTTP ${event.nativeEvent?.statusCode ?? '?'}`)}
        />
        {tilesLoading && !unavailable && (
          <View
            style={styles.tilesLoading}
            pointerEvents="none"
            testID={MAP_SURFACE_TILES_LOADING_TEST_ID}
          >
            <ActivityIndicator size="small" color={darkColors.textSecondary} />
          </View>
        )}
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
  tilesLoading: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
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

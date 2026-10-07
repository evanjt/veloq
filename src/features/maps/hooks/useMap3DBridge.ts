import { useMemo, type MutableRefObject } from 'react';

import { useWebViewBridge } from '@/features/maps/hooks/useWebViewBridge';
import type {
  WebViewBridgeHandlers,
  WebViewBridgeMessage,
} from '@/features/maps/hooks/useWebViewBridge';
import { debug } from '@/shared/debug/debug';

const log = debug.create('Map3D');

type Camera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

interface Map3DBridgeParams {
  mapReadyRef: MutableRefObject<boolean>;
  savedCameraRef: MutableRefObject<Camera | null>;
  onMapClickRef: MutableRefObject<((coordinate: [number, number]) => void) | undefined>;
  onSectionClickRef: MutableRefObject<((sectionId: string) => void) | undefined>;
  onActivityClickRef: MutableRefObject<
    ((activityId: string, hits: GeoJSON.Feature[]) => void) | undefined
  >;
  updateLayers: () => void;
  /** Draws the selected route when the page came up without it. */
  syncRoute: () => void;
  /** Moves a page that came up in its built style to the one the toggle shows. */
  syncStyle: () => void;
  onMapReady?: (() => void) | undefined;
  onMapFailed?: ((reason: string) => void) | undefined;
  onTerrainUnavailable?: ((reason: string) => void) | undefined;
  onBearingChange?: ((bearing: number) => void) | undefined;
  onCameraStateChange?: ((camera: Camera, gesture: boolean) => void) | undefined;
}

// Parses and dispatches messages from the 3D MapLibre WebView. Handlers keep
// their bodies inline because each closes over the parent's refs and callbacks.
export function useMap3DBridge({
  mapReadyRef,
  savedCameraRef,
  onMapClickRef,
  onSectionClickRef,
  onActivityClickRef,
  updateLayers,
  syncRoute,
  syncStyle,
  onMapReady,
  onMapFailed,
  onTerrainUnavailable,
  onBearingChange,
  onCameraStateChange,
}: Map3DBridgeParams) {
  const bridgeHandlers = useMemo<WebViewBridgeHandlers>(
    () => ({
      console: (data: WebViewBridgeMessage) => {
        log.log(data.message);
      },
      mapReady: () => {
        mapReadyRef.current = true;
        onMapReady?.();
        syncStyle();
        syncRoute();
        // Update layers after map is ready - small delay ensures style is fully settled
        setTimeout(() => updateLayers(), 100);
      },
      // Terminal counterpart to mapReady. The page cannot render, so the
      // caller has to stop waiting rather than sit on a spinner.
      mapFailed: (data: WebViewBridgeMessage) => {
        mapReadyRef.current = false;
        onMapFailed?.(typeof data.reason === 'string' ? data.reason : 'unknown');
      },
      // Not a failure: the page rendered, it just has no elevation to drape
      // over. The caller drops to 2D rather than leaving a flat map that reads
      // as broken 3D.
      terrainUnavailable: (data: WebViewBridgeMessage) => {
        onTerrainUnavailable?.(typeof data.reason === 'string' ? data.reason : 'unknown');
      },
      bearingChange: (data: WebViewBridgeMessage) => {
        if (typeof data.bearing === 'number') {
          onBearingChange?.(data.bearing);
        }
      },
      cameraState: (data: WebViewBridgeMessage) => {
        if (!data.camera) return;
        const camera = data.camera as Camera;
        // Save camera state for restoration
        savedCameraRef.current = camera;
        onCameraStateChange?.(camera, data.gesture === true);
      },
      mapClick: (data: WebViewBridgeMessage) => {
        if (Array.isArray(data.coordinate) && data.coordinate.length === 2) {
          onMapClickRef.current?.(data.coordinate as [number, number]);
        }
      },
      sectionClick: (data: WebViewBridgeMessage) => {
        if (typeof data.sectionId === 'string') {
          onSectionClickRef.current?.(data.sectionId);
        }
      },
      activityClick: (data: WebViewBridgeMessage) => {
        if (typeof data.activityId === 'string') {
          onActivityClickRef.current?.(
            data.activityId,
            Array.isArray(data.features) ? (data.features as GeoJSON.Feature[]) : []
          );
        }
      },
    }),
    [
      mapReadyRef,
      savedCameraRef,
      onMapClickRef,
      onSectionClickRef,
      onActivityClickRef,
      onMapReady,
      onMapFailed,
      onTerrainUnavailable,
      onBearingChange,
      onCameraStateChange,
      updateLayers,
      syncRoute,
      syncStyle,
    ]
  );

  return useWebViewBridge(bridgeHandlers);
}

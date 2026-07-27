import { useMemo, type MutableRefObject } from 'react';
import type { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

import { HEATMAP_TILES_DIR } from '@/features/maps/hooks/useHeatmapTiles';
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
  webViewRef: MutableRefObject<WebView | null>;
  mapReadyRef: MutableRefObject<boolean>;
  savedCameraRef: MutableRefObject<Camera | null>;
  onMapClickRef: MutableRefObject<((coordinate: [number, number]) => void) | undefined>;
  onSectionClickRef: MutableRefObject<((sectionId: string) => void) | undefined>;
  onActivityClickRef: MutableRefObject<((activityId: string) => void) | undefined>;
  updateLayers: () => void;
  onMapReady?: () => void;
  onBearingChange?: (bearing: number) => void;
  onCameraStateChange?: (camera: Camera) => void;
}

// Parses and dispatches messages from the 3D MapLibre WebView. Handlers keep
// their bodies inline because each closes over the parent's refs and callbacks.
export function useMap3DBridge({
  webViewRef,
  mapReadyRef,
  savedCameraRef,
  onMapClickRef,
  onSectionClickRef,
  onActivityClickRef,
  updateLayers,
  onMapReady,
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
        // Update layers after map is ready - small delay ensures style is fully settled
        setTimeout(() => updateLayers(), 100);
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
        onCameraStateChange?.(camera);
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
          onActivityClickRef.current?.(data.activityId);
        }
      },
      heatmapTileRequest: (data: WebViewBridgeMessage) => {
        if (!data.requestId || !data.tilePath) return;
        const requestId = data.requestId as string;
        const tilePath = data.tilePath as string;
        // Heatmap tile request from WebView - read PNG from filesystem, return as base64
        const fullPath = `${HEATMAP_TILES_DIR}${tilePath}`;
        FileSystem.getInfoAsync(fullPath)
          .then((info) => {
            if (info.exists && info.size > 0) {
              return FileSystem.readAsStringAsync(fullPath, {
                encoding: FileSystem.EncodingType.Base64,
              });
            }
            return null;
          })
          .then((base64) => {
            if (!webViewRef.current) return;
            if (base64) {
              // MapLibre's addProtocol expects { data: ArrayBuffer } for raster
              // tiles. The previous implementation passed an Image (decode
              // failed) and built a Blob via `new Blob([atob(b64)])` which
              // re-encodes the binary string as UTF-8 - the PNG bytes get
              // mangled. Convert base64 → Uint8Array → ArrayBuffer manually
              // by walking charCodeAt to preserve raw bytes.
              webViewRef.current.injectJavaScript(`
                  (function() {
                    var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                    if (!req) return;
                    try {
                      var binary = atob('${base64}');
                      var len = binary.length;
                      var bytes = new Uint8Array(len);
                      for (var i = 0; i < len; i++) {
                        bytes[i] = binary.charCodeAt(i);
                      }
                      req.resolve({ data: bytes.buffer });
                    } catch (err) {
                      req.reject(new Error('heatmap base64 decode failed: ' + err));
                    }
                    delete window._heatmapRequests['${requestId}'];
                  })();
                  true;
                `);
            } else {
              // Tile not found
              webViewRef.current.injectJavaScript(`
                  (function() {
                    var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                    if (req) {
                      req.reject(new Error('not found'));
                      delete window._heatmapRequests['${requestId}'];
                    }
                  })();
                  true;
                `);
            }
          })
          .catch(() => {
            // Read error
            webViewRef.current?.injectJavaScript(`
                (function() {
                  var req = window._heatmapRequests && window._heatmapRequests['${requestId}'];
                  if (req) {
                    req.reject(new Error('read error'));
                    delete window._heatmapRequests['${requestId}'];
                  }
                })();
                true;
              `);
          });
      },
    }),
    [
      webViewRef,
      mapReadyRef,
      savedCameraRef,
      onMapClickRef,
      onSectionClickRef,
      onActivityClickRef,
      onMapReady,
      onBearingChange,
      onCameraStateChange,
      updateLayers,
    ]
  );

  return useWebViewBridge(bridgeHandlers);
}

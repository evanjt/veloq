/**
 * Camera position management for ActivityMapView.
 *
 * Manages all camera-related state: position tracking, bounds fitting,
 * style-change camera restoration, bearing/compass sync, location lookup,
 * map-ready state, and iOS tile-retry logic.
 *
 * Extracted from ActivityMapView.tsx — pure refactor, no behaviour change.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Animated, Platform } from 'react-native';
import { Camera, type MapView } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import type { LatLng } from '@/lib';
import { getMapLibreBounds } from '@/lib';
import type { Map3DWebViewRef } from '@/components/maps/Map3DWebView';

/** Bounds returned by getMapLibreBounds */
export interface MapBounds {
  ne: [number, number];
  sw: [number, number];
}

interface UseMapCameraParams {
  validCoordinates: LatLng[];
  mapStyle: string;
  is3DMode: boolean;
  is3DReady: boolean;
  map3DRef: React.RefObject<Map3DWebViewRef | null>;
}

interface UseMapCameraResult {
  /** Ref to attach to MapLibre Camera component */
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  /** Ref to attach to MapLibre MapView (for iOS tap coordinate conversion) */
  mapRef: React.RefObject<React.ElementRef<typeof MapView> | null>;
  /** Whether the 2D map has finished loading and is ready for camera commands */
  mapReady: boolean;
  /** Key to force-remount the MapView (iOS retry mechanism) */
  mapKey: number;
  /** Computed bounds for the activity track */
  bounds: MapBounds | null;
  /** Center of computed bounds ([lng, lat]) */
  boundsCenter: [number, number] | null;
  /** Current viewport center ref (updated on region change, no re-renders) */
  currentCenterRef: React.MutableRefObject<[number, number] | null>;
  /** Current viewport zoom ref (updated on region change, no re-renders) */
  currentZoomRef: React.MutableRefObject<number>;
  /** Animated bearing value for compass arrow (degrees, negated) */
  bearingAnim: Animated.Value;
  /** Whether GPS location is currently loading */
  locationLoading: boolean;
  /** Called when the map finishes loading (resets ready state, restores camera) */
  handleMapFinishLoading: () => void;
  /** Called when the map fails to load (iOS retry) */
  handleMapLoadError: () => void;
  /** Called on region-is-changing (bearing sync for compass) */
  handleRegionIsChanging: (feature: GeoJSON.Feature) => void;
  /** Called on region-did-change (viewport tracking, attribution debounce) */
  handleRegionDidChange: (feature: GeoJSON.Feature) => void;
  /** Reset map orientation to north */
  resetOrientation: () => void;
  /** Get user location and fly camera there */
  handleGetLocation: () => Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export function useMapCamera({
  validCoordinates,
  mapStyle,
  is3DMode,
  is3DReady,
  map3DRef,
}: UseMapCameraParams): UseMapCameraResult {
  // ----- refs -----
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);

  // ----- retry / ready state -----
  const [mapKey, setMapKey] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const retryCountRef = useRef(0);

  // ----- camera position tracking (refs, not state — avoids re-renders during gestures) -----
  const pendingCameraRestoreRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const isInitialMountRef = useRef(true);
  const initialCameraAppliedRef = useRef(false);

  // ----- compass -----
  const bearingAnim = useRef(new Animated.Value(0)).current;

  // ----- GPS location -----
  const [locationLoading, setLocationLoading] = useState(false);

  // ----- bounds -----
  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

  const boundsCenter = useMemo((): [number, number] | null => {
    if (!bounds) return null;
    const centerLng = (bounds.ne[0] + bounds.sw[0]) / 2;
    const centerLat = (bounds.ne[1] + bounds.sw[1]) / 2;
    return [centerLng, centerLat];
  }, [bounds]);

  const currentCenterRef = useRef<[number, number] | null>(boundsCenter);
  const currentZoomRef = useRef(14);

  // Update ref initial value if bounds becomes available after mount
  if (boundsCenter && !currentCenterRef.current) {
    currentCenterRef.current = boundsCenter;
  }

  // ----- stop in-flight animations on unmount -----
  useEffect(() => {
    return () => {
      bearingAnim.stopAnimation();
    };
  }, [bearingAnim]);

  // ----- iOS tile retry -----
  const handleMapLoadError = useCallback(() => {
    if (Platform.OS === 'ios' && retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1;
      if (__DEV__) {
        console.log(
          `[ActivityMap] Load failed, retrying (${retryCountRef.current}/${MAX_RETRIES})...`
        );
      }
      setMapReady(false);
      setTimeout(() => {
        setMapKey((k) => k + 1);
      }, RETRY_DELAY_MS * retryCountRef.current);
    }
  }, []);

  // ----- map finish loading → restore camera -----
  const handleMapFinishLoading = useCallback(() => {
    if (__DEV__) {
      console.log('[ActivityMapView:Camera] handleMapFinishLoading called', {
        hasPendingRestore: !!pendingCameraRestoreRef.current,
        pendingCenter: pendingCameraRestoreRef.current?.center,
        pendingZoom: pendingCameraRestoreRef.current?.zoom,
      });
    }
    if (pendingCameraRestoreRef.current) {
      const { center, zoom } = pendingCameraRestoreRef.current;
      if (__DEV__) {
        console.log('[ActivityMapView:Camera] RESTORING position via setCamera', { center, zoom });
      }
      cameraRef.current?.setCamera({
        centerCoordinate: center,
        zoomLevel: zoom,
        animationDuration: 0,
        animationMode: 'moveTo',
      });
      pendingCameraRestoreRef.current = null;
    }
    if (__DEV__) {
      console.log('[ActivityMapView:Camera] Setting mapReady=true in 50ms');
    }
    setTimeout(() => setMapReady(true), 50);
  }, []);

  // ----- style/key change → save current position for restore, reset ready state -----
  useEffect(() => {
    if (__DEV__) {
      console.log('[ActivityMapView:Camera] Style/Key change effect', {
        mapStyle,
        mapKey,
        isInitialMount: isInitialMountRef.current,
        currentCenter: currentCenterRef.current,
        currentZoom: currentZoomRef.current,
      });
    }
    retryCountRef.current = 0;

    if (!isInitialMountRef.current && currentCenterRef.current && currentZoomRef.current) {
      pendingCameraRestoreRef.current = {
        center: currentCenterRef.current,
        zoom: currentZoomRef.current,
      };
      if (__DEV__) {
        console.log(
          '[ActivityMapView:Camera] Saved position for restore',
          pendingCameraRestoreRef.current
        );
      }
    }
    isInitialMountRef.current = false;
    if (__DEV__) {
      console.log('[ActivityMapView:Camera] Setting mapReady=false');
    }
    setMapReady(false);

    // Fallback: if onDidFinishLoadingMap never fires (e.g. embedded style loads
    // before the JS event listener is attached), force mapReady after 1s.
    const fallbackTimer = setTimeout(() => {
      setMapReady((current) => {
        if (!current) {
          if (__DEV__) {
            console.log(
              '[ActivityMapView:Camera] Fallback: forcing mapReady=true (onDidFinishLoadingMap not received)'
            );
          }
          return true;
        }
        return current;
      });
    }, 500);

    return () => clearTimeout(fallbackTimer);
  }, [mapStyle, mapKey]);

  // ----- apply initial bounds once -----
  useEffect(() => {
    if (__DEV__) {
      console.log('[ActivityMapView:Camera] Initial bounds effect check', {
        alreadyApplied: initialCameraAppliedRef.current,
        mapReady,
        hasBounds: !!bounds,
        hasCameraRef: !!cameraRef.current,
      });
    }
    if (initialCameraAppliedRef.current) {
      if (__DEV__) {
        console.log('[ActivityMapView:Camera] Skipping - already applied');
      }
      return;
    }
    if (mapReady && bounds && cameraRef.current) {
      if (__DEV__) {
        console.log('[ActivityMapView:Camera] APPLYING initial bounds via setCamera', bounds);
      }
      cameraRef.current.setCamera({
        bounds: { ne: bounds.ne, sw: bounds.sw },
        padding: {
          paddingTop: 50,
          paddingRight: 50,
          paddingBottom: 50,
          paddingLeft: 50,
        },
        animationDuration: 0,
        animationMode: 'moveTo',
      });
      initialCameraAppliedRef.current = true;
    }
  }, [mapReady, bounds]);

  // ----- bearing sync (compass) -----
  const handleRegionIsChanging = useCallback(
    (feature: GeoJSON.Feature) => {
      const properties = feature.properties as { heading?: number } | undefined;
      if (properties?.heading !== undefined) {
        bearingAnim.setValue(-properties.heading);
      }
    },
    [bearingAnim]
  );

  // ----- region did change → viewport tracking -----
  const handleRegionDidChange = useCallback((feature: GeoJSON.Feature) => {
    const properties = feature.properties as
      | {
          zoomLevel?: number;
          visibleBounds?: [[number, number], [number, number]];
        }
      | undefined;
    const { zoomLevel, visibleBounds } = properties ?? {};

    if (zoomLevel !== undefined) {
      currentZoomRef.current = zoomLevel;
    }

    if (feature.geometry?.type === 'Point') {
      currentCenterRef.current = feature.geometry.coordinates as [number, number];
    } else if (visibleBounds) {
      const [[swLng, swLat], [neLng, neLat]] = visibleBounds;
      const centerLng = (swLng + neLng) / 2;
      const centerLat = (swLat + neLat) / 2;
      currentCenterRef.current = [centerLng, centerLat];
    }

    if (__DEV__ && zoomLevel !== undefined) {
      console.log('[ActivityMapView:Camera] onRegionDidChange', {
        zoomLevel: zoomLevel.toFixed(2),
        center: currentCenterRef.current,
      });
    }
  }, []);

  // ----- reset orientation -----
  const resetOrientation = useCallback(() => {
    if (is3DMode && is3DReady) {
      map3DRef.current?.resetOrientation();
    } else {
      cameraRef.current?.setCamera({
        heading: 0,
        animationDuration: 300,
      });
    }
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [bearingAnim, is3DMode, is3DReady, map3DRef]);

  // ----- GPS location -----
  const handleGetLocation = useCallback(async () => {
    try {
      setLocationLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationLoading(false);
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: [number, number] = [location.coords.longitude, location.coords.latitude];
      setLocationLoading(false);
      cameraRef.current?.setCamera({
        centerCoordinate: coords,
        zoomLevel: 14,
        animationDuration: 500,
      });
    } catch {
      setLocationLoading(false);
    }
  }, []);

  return {
    cameraRef,
    mapRef,
    mapReady,
    mapKey,
    bounds,
    boundsCenter,
    currentCenterRef,
    currentZoomRef,
    bearingAnim,
    locationLoading,
    handleMapFinishLoading,
    handleMapLoadError,
    handleRegionIsChanging,
    handleRegionDidChange,
    resetOrientation,
    handleGetLocation,
  };
}

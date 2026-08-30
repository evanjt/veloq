/**
 * Camera position management for ActivityMapView.
 *
 * Tracks the viewport, fits the track once, syncs the compass and finds the
 * user. Position lives in refs rather than state so a gesture does not
 * re-render the tree sixty times a second.
 *
 * The renderer keeps its own camera across a style swap, so there is no saved
 * position to restore and no remount to retry.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Animated } from 'react-native';
import * as Location from 'expo-location';
import { type LatLng, getMapLibreBounds } from '@/shared/geo/polyline';
import type { MapCameraState, MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { Map3DWebViewRef } from '@/features/maps/components/Map3DWebView';

/** Bounds returned by getMapLibreBounds */
interface MapBounds {
  ne: [number, number];
  sw: [number, number];
}

/** Room left around the fitted track, in pixels. */
const FIT_PADDING = 50;

interface UseMapCameraParams {
  validCoordinates: LatLng[];
  is3DMode: boolean;
  is3DReady: boolean;
  map3DRef: React.RefObject<Map3DWebViewRef | null>;
}

interface UseMapCameraResult {
  /** Ref to attach to the map surface */
  surfaceRef: React.RefObject<MapSurfaceRef | null>;
  /** Whether the 2D map has finished loading and is ready for camera commands */
  mapReady: boolean;
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
  /** Called once the surface reports it is ready */
  handleMapReady: () => void;
  /** Called continuously during a gesture (bearing sync for compass) */
  handleRegionIsChanging: (state: MapCameraState) => void;
  /** Called once a gesture settles (viewport tracking) */
  handleRegionDidChange: (state: MapCameraState) => void;
  /** Reset map orientation to north */
  resetOrientation: () => void;
  /** Get user location and fly camera there */
  handleGetLocation: () => Promise<void>;
}

export function useMapCamera({
  validCoordinates,
  is3DMode,
  is3DReady,
  map3DRef,
}: UseMapCameraParams): UseMapCameraResult {
  const surfaceRef = useRef<MapSurfaceRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const bearingAnim = useRef(new Animated.Value(0)).current;
  const initialCameraAppliedRef = useRef(false);

  const bounds = useMemo(() => getMapLibreBounds(validCoordinates), [validCoordinates]);

  const boundsCenter = useMemo((): [number, number] | null => {
    if (!bounds) return null;
    return [(bounds.ne[0] + bounds.sw[0]) / 2, (bounds.ne[1] + bounds.sw[1]) / 2];
  }, [bounds]);

  const currentCenterRef = useRef<[number, number] | null>(boundsCenter);
  const currentZoomRef = useRef(14);

  // Update ref initial value if bounds becomes available after mount
  if (boundsCenter && !currentCenterRef.current) {
    currentCenterRef.current = boundsCenter;
  }

  useEffect(() => {
    return () => {
      bearingAnim.stopAnimation();
    };
  }, [bearingAnim]);

  const handleMapReady = useCallback(() => {
    setMapReady(true);
  }, []);

  // Fit the track once. Later bounds changes are the user's business.
  useEffect(() => {
    if (initialCameraAppliedRef.current) return;
    if (!mapReady || !bounds) return;
    surfaceRef.current?.fitBounds({ sw: bounds.sw, ne: bounds.ne }, FIT_PADDING);
    initialCameraAppliedRef.current = true;
  }, [mapReady, bounds]);

  const handleRegionIsChanging = useCallback(
    (state: MapCameraState) => {
      bearingAnim.setValue(-state.bearing);
    },
    [bearingAnim]
  );

  const handleRegionDidChange = useCallback((state: MapCameraState) => {
    currentCenterRef.current = state.center;
    currentZoomRef.current = state.zoom;
  }, []);

  const resetOrientation = useCallback(() => {
    if (is3DMode && is3DReady) {
      map3DRef.current?.resetOrientation();
    } else {
      surfaceRef.current?.resetOrientation();
    }
    Animated.timing(bearingAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [bearingAnim, is3DMode, is3DReady, map3DRef]);

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
      setLocationLoading(false);
      surfaceRef.current?.setCamera(
        { center: [location.coords.longitude, location.coords.latitude], zoom: 14 },
        500
      );
    } catch {
      setLocationLoading(false);
    }
  }, []);

  return {
    surfaceRef,
    mapReady,
    bounds,
    boundsCenter,
    currentCenterRef,
    currentZoomRef,
    bearingAnim,
    locationLoading,
    handleMapReady,
    handleRegionIsChanging,
    handleRegionDidChange,
    resetOrientation,
    handleGetLocation,
  };
}

/**
 * Manages section creation state, tap handling, computed geometry,
 * and confirm/cancel/reset callbacks for ActivityMapView.
 * Extracted from ActivityMapView.tsx.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { LatLng } from '@/lib';
import type { RoutePoint } from '@/types';
import type { CreationState } from '@/components/maps/SectionCreationOverlay';
import type { SectionCreationResult } from '@/components/maps/ActivityMapView';

/** Calculate distance between two coordinates using Haversine formula */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface UseSectionCreationParams {
  creationMode: boolean;
  externalCreationState: CreationState | undefined;
  validCoordinates: LatLng[];
  onSectionCreated?: (result: SectionCreationResult) => void;
  onCreationCancelled?: () => void;
}

interface UseSectionCreationResult {
  creationState: CreationState;
  startIndex: number | null;
  endIndex: number | null;
  sectionDistance: number | null;
  sectionPointCount: number | null;
  sectionGeoJSON: GeoJSON.FeatureCollection | GeoJSON.Feature;
  sectionHasData: boolean;
  sectionStartPoint: LatLng | null;
  sectionEndPoint: LatLng | null;
  /** Handle a map tap during creation mode. Returns true if the tap was consumed. */
  handleCreationTap: (lng: number, lat: number) => boolean;
  handleCreationConfirm: () => void;
  handleCreationCancel: () => void;
  handleCreationReset: () => void;
}

export function useSectionCreation({
  creationMode,
  externalCreationState,
  validCoordinates,
  onSectionCreated,
  onCreationCancelled,
}: UseSectionCreationParams): UseSectionCreationResult {
  const [creationState, setCreationState] = useState<CreationState>('selectingStart');
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);

  // Track previous external creation state to detect transitions
  const prevExternalCreationStateRef = useRef<CreationState | undefined>(externalCreationState);

  // Reset section creation state when mode changes
  useEffect(() => {
    if (__DEV__) {
      console.log('[useSectionCreation] creationMode effect', { creationMode });
    }
    if (creationMode) {
      setCreationState('selectingStart');
      setStartIndex(null);
      setEndIndex(null);
    }
  }, [creationMode]);

  // Reset internal state ONLY when transitioning from 'error' to undefined (user clicked retry)
  // Do NOT reset when transitioning from 'creating' to undefined (success path)
  useEffect(() => {
    const wasError = prevExternalCreationStateRef.current === 'error';
    const nowUndefined = externalCreationState === undefined;

    if (creationMode && wasError && nowUndefined) {
      if (__DEV__) {
        console.log('[useSectionCreation] Resetting selection after error dismissal');
      }
      setCreationState('selectingStart');
      setStartIndex(null);
      setEndIndex(null);
    }

    prevExternalCreationStateRef.current = externalCreationState;
  }, [creationMode, externalCreationState]);

  const handleCreationTap = useCallback(
    (lng: number, lat: number): boolean => {
      if (!creationMode) return false;
      if (validCoordinates.length === 0) return false;

      // Find nearest point on the route
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (let i = 0; i < validCoordinates.length; i++) {
        const coord = validCoordinates[i];
        const dx = coord.longitude - lng;
        const dy = coord.latitude - lat;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = i;
        }
      }

      if (creationState === 'selectingStart') {
        if (__DEV__) {
          console.log('[useSectionCreation] Setting startIndex', { nearestIndex });
        }
        setStartIndex(nearestIndex);
        setCreationState('selectingEnd');
        return true;
      } else if (creationState === 'selectingEnd') {
        // Ensure end is after start
        if (nearestIndex <= (startIndex ?? 0)) {
          if (__DEV__) {
            console.log('[useSectionCreation] Swapping start/end', { nearestIndex, startIndex });
          }
          setEndIndex(startIndex);
          setStartIndex(nearestIndex);
        } else {
          if (__DEV__) {
            console.log('[useSectionCreation] Setting endIndex', { nearestIndex });
          }
          setEndIndex(nearestIndex);
        }
        setCreationState('complete');
        return true;
      }

      return false;
    },
    [creationMode, creationState, startIndex, validCoordinates]
  );

  const handleCreationConfirm = useCallback(() => {
    if (startIndex === null || endIndex === null) return;

    // Extract section polyline
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    const polyline: RoutePoint[] = sectionCoords.map((c) => ({
      lat: c.latitude,
      lng: c.longitude,
    }));

    // Calculate distance using Haversine
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }

    onSectionCreated?.({
      polyline,
      startIndex,
      endIndex,
      distanceMeters: distance,
    });

    // Reset state
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, [startIndex, endIndex, validCoordinates, onSectionCreated]);

  const handleCreationCancel = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
    onCreationCancelled?.();
  }, [onCreationCancelled]);

  const handleCreationReset = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  // Computed values
  const sectionDistance = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    const sectionCoords = validCoordinates.slice(startIndex, endIndex + 1);
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
    return distance;
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  const sectionPointCount = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    return endIndex - startIndex + 1;
  }, [creationMode, startIndex, endIndex]);

  const sectionGeoJSON = useMemo((): GeoJSON.FeatureCollection | GeoJSON.Feature => {
    if (!creationMode || startIndex === null) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const end = endIndex ?? startIndex;
    const sectionCoords = validCoordinates.slice(startIndex, end + 1);
    if (sectionCoords.length < 2) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: sectionCoords.map((c) => [c.longitude, c.latitude]),
      },
    };
  }, [creationMode, startIndex, endIndex, validCoordinates]);

  const sectionHasData =
    sectionGeoJSON.type === 'Feature' ||
    (sectionGeoJSON.type === 'FeatureCollection' && sectionGeoJSON.features.length > 0);

  const sectionStartPoint =
    creationMode && startIndex !== null ? validCoordinates[startIndex] : null;
  const sectionEndPoint = creationMode && endIndex !== null ? validCoordinates[endIndex] : null;

  return {
    creationState,
    startIndex,
    endIndex,
    sectionDistance,
    sectionPointCount,
    sectionGeoJSON,
    sectionHasData,
    sectionStartPoint,
    sectionEndPoint,
    handleCreationTap,
    handleCreationConfirm,
    handleCreationCancel,
    handleCreationReset,
  };
}

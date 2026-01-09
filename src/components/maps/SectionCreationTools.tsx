/**
 * @fileoverview SectionCreationTools - Route section creation UI
 *
 * Handles the two-tap interaction for creating route sections:
 * select start point → select end point → confirm
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import type { LatLng } from '@/lib';
import { SectionCreationOverlay, type CreationState } from './SectionCreationOverlay';
import type { SectionCreationResult } from './ActivityMapView';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

interface SectionCreationToolsProps {
  /** Whether section creation mode is active */
  creationMode: boolean;
  /** Valid coordinates for the activity */
  coordinates: LatLng[];
  /** Called when a section is created */
  onSectionCreated: (result: SectionCreationResult) => void;
  /** Called when section creation is cancelled */
  onCreationCancelled: () => void;
}

/**
 * Section creation tools UI.
 *
 * Manages the two-tap flow:
 * 1. User taps start point
 * 2. User taps end point
 * 3. User confirms or cancels
 *
 * Shows distance calculation and visual feedback throughout.
 *
 * @example
 * ```tsx
 * <SectionCreationTools
 *   creationMode={isEditing}
 *   coordinates={activityCoordinates}
 *   onSectionCreated={(result) => {
 *     console.log('Section:', result.distanceMeters, 'm');
 *   }}
 *   onCreationCancelled={() => setIsEditing(false)}
 * />
 * ```
 */
export function SectionCreationTools({
  creationMode,
  coordinates,
  onSectionCreated,
  onCreationCancelled,
}: SectionCreationToolsProps) {
  const [creationState, setCreationState] = useState<CreationState>('selectingStart');
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);

  // Calculate distance between two coordinates using Haversine formula
  const haversineDistance = useCallback(
    (lat1: number, lon1: number, lat2: number, lon2: number): number => {
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
    },
    []
  );

  // Calculate section distance
  const sectionDistance = useMemo(() => {
    if (!creationMode || startIndex === null || endIndex === null) return null;
    const sectionCoords = coordinates.slice(startIndex, endIndex + 1);
    let distance = 0;
    for (let i = 1; i < sectionCoords.length; i++) {
      const prev = sectionCoords[i - 1];
      const curr = sectionCoords[i];
      distance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
    return distance;
  }, [creationMode, startIndex, endIndex, coordinates, haversineDistance]);

  // Handle tap on map to select point
  const handlePointSelect = useCallback(
    (index: number) => {
      if (!creationMode) return;

      if (creationState === 'selectingStart') {
        setStartIndex(index);
        setCreationState('selectingEnd');
      } else if (creationState === 'selectingEnd') {
        // Ensure end is after start
        const newEndIndex = index >= startIndex! ? index : startIndex!;
        setEndIndex(newEndIndex);
        setCreationState('confirming');
      }
    },
    [creationMode, creationState, startIndex]
  );

  // Handle confirm button
  const handleConfirm = useCallback(() => {
    if (startIndex === null || endIndex === null) return;

    const sectionCoords = coordinates.slice(startIndex, endIndex + 1);
    const polyline: SectionCreationResult['polyline'] = sectionCoords.map((coord) => ({
      lat: coord.latitude,
      lng: coord.longitude,
    }));

    onSectionCreated({
      polyline,
      startIndex,
      endIndex,
      distanceMeters: sectionDistance || 0,
    });

    // Reset state
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, [startIndex, endIndex, coordinates, sectionDistance, onSectionCreated]);

  // Handle cancel button
  const handleCancel = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
    onCreationCancelled();
  }, [onCreationCancelled]);

  // Handle reset (clear selection without exiting mode)
  const handleReset = useCallback(() => {
    setCreationState('selectingStart');
    setStartIndex(null);
    setEndIndex(null);
  }, []);

  // Reset state when mode changes
  React.useEffect(() => {
    if (creationMode) {
      setCreationState('selectingStart');
      setStartIndex(null);
      setEndIndex(null);
    }
  }, [creationMode]);

  // Don't render if not in creation mode
  if (!creationMode) {
    return null;
  }

  return (
    <SectionCreationOverlay
      state={creationState}
      startIndex={startIndex}
      endIndex={endIndex}
      coordinateCount={coordinates.length}
      sectionDistance={sectionDistance}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      onReset={handleReset}
    />
  );
}

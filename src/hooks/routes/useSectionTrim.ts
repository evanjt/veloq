/**
 * Hook for trimming section bounds via a range slider.
 * Manages trimming state, computes trimmed distance in pure TS (haversine),
 * and calls Rust FFI for save/reset operations.
 */

import { useState, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { FrequentSection, RoutePoint } from '@/types';

/** Haversine distance between two points in meters. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Calculate polyline distance in meters from an array of RoutePoints. */
function polylineDistance(points: RoutePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return d;
}

interface UseSectionTrimResult {
  /** Whether the trim overlay is visible */
  isTrimming: boolean;
  /** Current start index in the polyline */
  trimStart: number;
  /** Current end index in the polyline */
  trimEnd: number;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Distance of the trimmed portion in meters */
  trimmedDistance: number;
  /** Whether the section can be reset to original bounds */
  canReset: boolean;
  /** Enter trimming mode */
  startTrim: () => void;
  /** Cancel trimming without saving */
  cancelTrim: () => void;
  /** Save the current trim and re-match activities */
  confirmTrim: () => void;
  /** Reset to original (pre-trim) bounds */
  resetBounds: () => void;
  /** Update the trim start index */
  setTrimStart: (index: number) => void;
  /** Update the trim end index */
  setTrimEnd: (index: number) => void;
}

export function useSectionTrim(
  section: FrequentSection | null,
  onRefresh: () => void
): UseSectionTrimResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [isTrimming, setIsTrimming] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Memoized trimmed distance (pure TS, no FFI)
  const trimmedDistance = useMemo(() => {
    if (!section?.polyline || !isTrimming) return section?.distanceMeters ?? 0;
    const sliced = section.polyline.slice(trimStart, trimEnd + 1);
    if (sliced.length < 2) return 0;
    return polylineDistance(sliced);
  }, [section?.polyline, section?.distanceMeters, isTrimming, trimStart, trimEnd]);

  // Check if section has original bounds that can be restored
  const canReset = useMemo(() => {
    if (!section?.id) return false;
    const engine = getRouteEngine();
    if (!engine) return false;
    return engine.hasOriginalBounds(section.id);
  }, [section?.id]);

  const startTrim = useCallback(() => {
    if (!section?.polyline) return;
    setTrimStart(0);
    setTrimEnd(section.polyline.length - 1);
    setIsTrimming(true);
  }, [section?.polyline]);

  const cancelTrim = useCallback(() => {
    setIsTrimming(false);
  }, []);

  const confirmTrim = useCallback(() => {
    if (!section?.id) return;

    // Validate minimum
    if (trimEnd - trimStart + 1 < 5) {
      Alert.alert(
        t('common.error'),
        t('sections.trimTooShort', 'Section must have at least 5 points')
      );
      return;
    }

    setIsSaving(true);
    const engine = getRouteEngine();
    if (!engine) {
      setIsSaving(false);
      return;
    }

    const success = engine.trimSection(section.id, trimStart, trimEnd);
    setIsSaving(false);

    if (success) {
      setIsTrimming(false);
      queryClient.invalidateQueries({ queryKey: ['sections'] });
      onRefresh();
    } else {
      Alert.alert(t('common.error'), t('sections.trimFailed', 'Failed to trim section bounds'));
    }
  }, [section?.id, trimStart, trimEnd, queryClient, onRefresh, t]);

  const resetBounds = useCallback(() => {
    if (!section?.id) return;

    Alert.alert(t('sections.resetBounds'), t('sections.resetBoundsConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.reset'),
        onPress: () => {
          const engine = getRouteEngine();
          if (!engine) return;

          const success = engine.resetSectionBounds(section.id);
          if (success) {
            setIsTrimming(false);
            queryClient.invalidateQueries({ queryKey: ['sections'] });
            onRefresh();
          }
        },
      },
    ]);
  }, [section?.id, queryClient, onRefresh, t]);

  return {
    isTrimming,
    trimStart,
    trimEnd,
    isSaving,
    trimmedDistance,
    canReset,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    setTrimStart,
    setTrimEnd,
  };
}

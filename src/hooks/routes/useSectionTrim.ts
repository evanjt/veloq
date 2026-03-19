/**
 * Hook for trimming and expanding section bounds via a range slider.
 * Manages trimming state, computes trimmed distance in pure TS (haversine),
 * and calls Rust FFI for save/reset operations.
 *
 * Expansion: loads the representative activity's full GPS track so users
 * can extend the section beyond its current boundaries.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
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

interface ExtensionTrack {
  /** Full GPS track of the representative activity as RoutePoints */
  points: RoutePoint[];
  /** Where the current section starts in the extension track */
  sectionStartIdx: number;
  /** Where the current section ends in the extension track */
  sectionEndIdx: number;
}

interface UseSectionTrimResult {
  /** Whether the trim overlay is visible */
  isTrimming: boolean;
  /** Current start index (in the effective polyline: extension track or section polyline) */
  trimStart: number;
  /** Current end index (in the effective polyline) */
  trimEnd: number;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Distance of the trimmed/expanded portion in meters */
  trimmedDistance: number;
  /** Whether the section can be reset to original bounds */
  canReset: boolean;
  /** Extension track data (null if not loaded or unavailable) */
  extensionTrack: ExtensionTrack | null;
  /** Total number of points in the effective slider range */
  effectivePointCount: number;
  /** Enter trimming mode */
  startTrim: () => void;
  /** Cancel trimming without saving */
  cancelTrim: () => void;
  /** Save the current trim/expand and re-match activities */
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
  const [extensionTrack, setExtensionTrack] = useState<ExtensionTrack | null>(null);

  // Load extension track when entering edit mode
  useEffect(() => {
    if (!isTrimming || !section?.id) {
      setExtensionTrack(null);
      return;
    }

    const engine = getRouteEngine();
    if (!engine) return;

    try {
      const result = engine.getSectionExtensionTrack(section.id);
      if (result && result.track.length >= 4) {
        // Convert flat coords [lat, lng, lat, lng, ...] to RoutePoint[]
        const points: RoutePoint[] = [];
        for (let i = 0; i < result.track.length - 1; i += 2) {
          points.push({ lat: result.track[i], lng: result.track[i + 1] });
        }
        setExtensionTrack({
          points,
          sectionStartIdx: result.sectionStartIdx,
          sectionEndIdx: result.sectionEndIdx,
        });
      }
    } catch {
      // Extension track unavailable — trimming still works without it
    }
  }, [isTrimming, section?.id]);

  // The effective polyline used for the slider.
  // When extension track is available, the slider operates on the full activity track.
  // The section portion is highlighted within it.
  const effectivePointCount = useMemo(() => {
    if (extensionTrack) return extensionTrack.points.length;
    return section?.polyline?.length ?? 0;
  }, [extensionTrack, section?.polyline?.length]);

  // Memoized trimmed/expanded distance (pure TS, no FFI)
  const trimmedDistance = useMemo(() => {
    if (!isTrimming) return section?.distanceMeters ?? 0;

    if (extensionTrack) {
      // Operating on extension track
      const sliced = extensionTrack.points.slice(trimStart, trimEnd + 1);
      if (sliced.length < 2) return 0;
      return polylineDistance(sliced);
    }

    // Operating on section polyline (trim only)
    if (!section?.polyline) return 0;
    const sliced = section.polyline.slice(trimStart, trimEnd + 1);
    if (sliced.length < 2) return 0;
    return polylineDistance(sliced);
  }, [section?.polyline, section?.distanceMeters, isTrimming, trimStart, trimEnd, extensionTrack]);

  // Check if section has original bounds that can be restored
  const canReset = useMemo(() => {
    if (!section?.id) return false;
    const engine = getRouteEngine();
    if (!engine) return false;
    return engine.hasOriginalBounds(section.id);
  }, [section?.id]);

  const startTrim = useCallback(() => {
    if (!section?.polyline) return;
    // Default: select the full section range
    // When extension track loads, these will be updated to map to the section portion
    setTrimStart(0);
    setTrimEnd(section.polyline.length - 1);
    setIsTrimming(true);
  }, [section?.polyline]);

  // When extension track loads, remap slider to the section's position within it
  useEffect(() => {
    if (extensionTrack && isTrimming) {
      setTrimStart(extensionTrack.sectionStartIdx);
      setTrimEnd(extensionTrack.sectionEndIdx);
    }
  }, [extensionTrack, isTrimming]);

  const cancelTrim = useCallback(() => {
    setIsTrimming(false);
    setExtensionTrack(null);
  }, []);

  const confirmTrim = useCallback(() => {
    if (!section?.id) return;

    // Validate minimum points
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

    let success = false;

    if (extensionTrack) {
      // Check if the user expanded beyond the section or shrunk within it
      const isExpanded =
        trimStart < extensionTrack.sectionStartIdx || trimEnd > extensionTrack.sectionEndIdx;

      if (isExpanded) {
        // Expansion: extract the new polyline from the extension track and send to Rust
        const newPolyline = extensionTrack.points.slice(trimStart, trimEnd + 1).map((p) => ({
          latitude: p.lat,
          longitude: p.lng,
        }));
        const newPolylineJson = JSON.stringify(newPolyline);
        success = engine.expandSectionBounds(section.id, newPolylineJson);
      } else {
        // User shrunk within the section — map back to section polyline indices
        const sectionStart = trimStart - extensionTrack.sectionStartIdx;
        const sectionEnd = trimEnd - extensionTrack.sectionStartIdx;
        success = engine.trimSection(section.id, sectionStart, sectionEnd);
      }
    } else {
      // No extension track — pure trim on section polyline
      success = engine.trimSection(section.id, trimStart, trimEnd);
    }

    setIsSaving(false);

    if (success) {
      setIsTrimming(false);
      setExtensionTrack(null);
      queryClient.invalidateQueries({ queryKey: ['sections'] });
      onRefresh();
    } else {
      Alert.alert(t('common.error'), t('sections.trimFailed', 'Failed to trim section bounds'));
    }
  }, [section?.id, trimStart, trimEnd, extensionTrack, queryClient, onRefresh, t]);

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
            setExtensionTrack(null);
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
    extensionTrack,
    effectivePointCount,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    setTrimStart,
    setTrimEnd,
  };
}

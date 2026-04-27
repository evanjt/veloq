/**
 * Hook for trimming and expanding section bounds via a range slider.
 * Two modes: trim (default, section polyline) and expand (padded context window).
 *
 * Trim mode: slider operates on the section polyline. Handles span 0%–100%.
 * Expand mode: loads the representative activity's GPS track and shows a
 * padded window (~500m each side) so the user can extend the section bounds.
 */

import { useState, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { decodeCoords } from 'veloqrs';
import { queryKeys } from '@/lib/queryKeys';
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

/** Padded window context for expand mode */
interface ExpandContext {
  /** Points in the padded window (subset of the full activity track) */
  windowPoints: RoutePoint[];
  /** Start index of this window in the full extension track */
  windowStartIdx: number;
  /** Section start index relative to the window */
  sectionStartInWindow: number;
  /** Section end index relative to the window */
  sectionEndInWindow: number;
}

/**
 * Compute a padded window around the section within the full activity track.
 * Padding: max(500m, 50% of section length), capped at 2km each side.
 */
function computePaddedWindow(
  fullPoints: RoutePoint[],
  sectionStartIdx: number,
  sectionEndIdx: number,
  sectionDistance: number
): ExpandContext {
  const padding = Math.min(Math.max(500, sectionDistance * 0.5), 2000);

  // Walk backwards from section start to find window start
  let windowStartIdx = sectionStartIdx;
  let accDist = 0;
  for (let i = sectionStartIdx; i > 0; i--) {
    accDist += haversine(
      fullPoints[i].lat,
      fullPoints[i].lng,
      fullPoints[i - 1].lat,
      fullPoints[i - 1].lng
    );
    if (accDist >= padding) {
      windowStartIdx = i - 1;
      break;
    }
    windowStartIdx = i - 1;
  }

  // Walk forwards from section end to find window end
  let windowEndIdx = sectionEndIdx;
  accDist = 0;
  for (let i = sectionEndIdx; i < fullPoints.length - 1; i++) {
    accDist += haversine(
      fullPoints[i].lat,
      fullPoints[i].lng,
      fullPoints[i + 1].lat,
      fullPoints[i + 1].lng
    );
    if (accDist >= padding) {
      windowEndIdx = i + 1;
      break;
    }
    windowEndIdx = i + 1;
  }

  const windowPoints = fullPoints.slice(windowStartIdx, windowEndIdx + 1);
  return {
    windowPoints,
    windowStartIdx,
    sectionStartInWindow: sectionStartIdx - windowStartIdx,
    sectionEndInWindow: sectionEndIdx - windowStartIdx,
  };
}

interface UseSectionTrimResult {
  /** Whether the trim overlay is visible */
  isTrimming: boolean;
  /** Whether expand mode is active (vs trim mode) */
  isExpanded: boolean;
  /** Current start index (in the effective polyline) */
  trimStart: number;
  /** Current end index (in the effective polyline) */
  trimEnd: number;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Distance of the trimmed/expanded portion in meters */
  trimmedDistance: number;
  /** Whether the section can be reset to original bounds */
  canReset: boolean;
  /** Total number of points in the effective slider range */
  effectivePointCount: number;
  /** Section start index within expand window (for boundary markers) */
  sectionStartInWindow: number | undefined;
  /** Section end index within expand window (for boundary markers) */
  sectionEndInWindow: number | undefined;
  /** Expand context points for map display (null when in trim mode) */
  expandContextPoints: RoutePoint[] | null;
  /** Enter trimming mode */
  startTrim: () => void;
  /** Cancel trimming without saving */
  cancelTrim: () => void;
  /** Save the current trim/expand and re-match activities */
  confirmTrim: () => void;
  /** Reset to original (pre-trim) bounds */
  resetBounds: () => void;
  /** Toggle between trim and expand modes */
  toggleExpand: () => void;
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [expandContext, setExpandContext] = useState<ExpandContext | null>(null);

  // The effective polyline point count for the slider
  const effectivePointCount = useMemo(() => {
    if (isExpanded && expandContext) return expandContext.windowPoints.length;
    return section?.polyline?.length ?? 0;
  }, [isExpanded, expandContext, section?.polyline?.length]);

  // Memoized trimmed/expanded distance (pure TS, no FFI)
  const trimmedDistance = useMemo(() => {
    if (!isTrimming) return section?.distanceMeters ?? 0;

    if (isExpanded && expandContext) {
      const sliced = expandContext.windowPoints.slice(trimStart, trimEnd + 1);
      if (sliced.length < 2) return 0;
      return polylineDistance(sliced);
    }

    if (!section?.polyline) return 0;
    const sliced = section.polyline.slice(trimStart, trimEnd + 1);
    if (sliced.length < 2) return 0;
    return polylineDistance(sliced);
  }, [
    section?.polyline,
    section?.distanceMeters,
    isTrimming,
    isExpanded,
    expandContext,
    trimStart,
    trimEnd,
  ]);

  // Check if section has original bounds that can be restored
  const canReset = useMemo(() => {
    if (!section?.id) return false;
    const engine = getRouteEngine();
    if (!engine) return false;
    return engine.hasOriginalBounds(section.id);
  }, [section?.id]);

  const startTrim = useCallback(() => {
    if (!section?.polyline) return;
    // Start in trim mode on section polyline
    setTrimStart(0);
    setTrimEnd(section.polyline.length - 1);
    setIsExpanded(false);
    setExpandContext(null);
    setIsTrimming(true);
  }, [section?.polyline]);

  const toggleExpand = useCallback(() => {
    if (!section?.id || !section?.polyline) return;

    if (isExpanded) {
      // Switch back to trim mode
      setIsExpanded(false);
      setExpandContext(null);
      setTrimStart(0);
      setTrimEnd(section.polyline.length - 1);
      return;
    }

    // Switch to expand mode — load extension track and compute padded window
    const engine = getRouteEngine();
    if (!engine) return;

    try {
      const result = engine.getSectionExtensionTrack(section.id);
      if (!result) {
        Alert.alert(
          t('common.error'),
          t('sections.expandUnavailable', 'No activity track available for expansion')
        );
        return;
      }

      const fullPoints: RoutePoint[] = decodeCoords(result.encodedTrack).map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
      }));
      if (fullPoints.length < 2) {
        Alert.alert(
          t('common.error'),
          t('sections.expandUnavailable', 'No activity track available for expansion')
        );
        return;
      }

      const ctx = computePaddedWindow(
        fullPoints,
        result.sectionStartIdx,
        result.sectionEndIdx,
        section.distanceMeters
      );

      setExpandContext(ctx);
      setTrimStart(ctx.sectionStartInWindow);
      setTrimEnd(ctx.sectionEndInWindow);
      setIsExpanded(true);
    } catch {
      Alert.alert(
        t('common.error'),
        t('sections.expandUnavailable', 'No activity track available for expansion')
      );
    }
  }, [section?.id, section?.polyline, section?.distanceMeters, isExpanded, t]);

  const cancelTrim = useCallback(() => {
    setIsTrimming(false);
    setIsExpanded(false);
    setExpandContext(null);
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

    if (isExpanded && expandContext) {
      // Check if the user expanded beyond the section or shrunk within it
      const expandedBeyond =
        trimStart < expandContext.sectionStartInWindow ||
        trimEnd > expandContext.sectionEndInWindow;

      if (expandedBeyond) {
        // Expansion: extract new polyline from window points
        const windowSlice = expandContext.windowPoints.slice(trimStart, trimEnd + 1);
        const newPolylineFlat: number[] = [];
        for (const p of windowSlice) {
          newPolylineFlat.push(p.lat, p.lng);
        }
        success = engine.expandSectionBounds(section.id, newPolylineFlat);
      } else {
        // User shrunk within section — map window indices back to section polyline indices
        const sectionStart = trimStart - expandContext.sectionStartInWindow;
        const sectionEnd = trimEnd - expandContext.sectionStartInWindow;
        success = engine.trimSection(section.id, sectionStart, sectionEnd);
      }
    } else {
      // Trim mode — pure trim on section polyline
      success = engine.trimSection(section.id, trimStart, trimEnd);
    }

    setIsSaving(false);

    if (success) {
      setIsTrimming(false);
      setIsExpanded(false);
      setExpandContext(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
      onRefresh();
    } else {
      Alert.alert(t('common.error'), t('sections.trimFailed', 'Failed to trim section bounds'));
    }
  }, [section?.id, trimStart, trimEnd, isExpanded, expandContext, queryClient, onRefresh, t]);

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
            setIsExpanded(false);
            setExpandContext(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.sections.all });
            onRefresh();
          }
        },
      },
    ]);
  }, [section?.id, queryClient, onRefresh, t]);

  return {
    isTrimming,
    isExpanded,
    trimStart,
    trimEnd,
    isSaving,
    trimmedDistance,
    canReset,
    effectivePointCount,
    sectionStartInWindow: expandContext?.sectionStartInWindow,
    sectionEndInWindow: expandContext?.sectionEndInWindow,
    expandContextPoints: expandContext?.windowPoints ?? null,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    toggleExpand,
    setTrimStart,
    setTrimEnd,
  };
}

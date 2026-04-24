import { useState, useEffect, useMemo, useCallback } from 'react';
import { routeEngine } from 'veloqrs';
import type { SectionOverlay } from '@/components/maps/ActivityMapView';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import type { Section } from '@/types';

interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Computes section trace overlays for an activity.
 *
 * Combines trace computation (via Rust engine's extractSectionTrace)
 * with overlay building for map display. Only activates when
 * `activeTab === 'sections'`.
 */
export function useSectionOverlays(
  activeTab: string,
  activityId: string | undefined,
  engineSectionMatches: SectionMatch[],
  customMatchedSections: Section[],
  coordinates: LatLng[]
) {
  // Internal state for computed traces
  const [computedActivityTraces, setComputedActivityTraces] = useState<Record<string, LatLng[]>>(
    {}
  );

  // Create stable section IDs string to avoid infinite loops
  const engineSectionIds = useMemo(
    () =>
      engineSectionMatches
        .map((m) => m.section.id)
        .sort()
        .join(','),
    [engineSectionMatches]
  );
  const customSectionIds = useMemo(
    () =>
      customMatchedSections
        .map((s) => s.id)
        .sort()
        .join(','),
    [customMatchedSections]
  );

  // Compute activity traces using Rust engine's extractSectionTrace
  // Always compute traces (not just on sections tab) so overlays show on the map immediately
  useEffect(() => {
    if (!activityId) {
      return;
    }

    // Deduplicate sections by ID (custom sections might appear in both lists)
    const seenIds = new Set<string>();
    const combinedSections = [
      ...engineSectionMatches.map((m) => m.section),
      ...customMatchedSections,
    ].filter((section) => {
      if (seenIds.has(section.id)) return false;
      seenIds.add(section.id);
      return true;
    });
    if (combinedSections.length === 0) {
      setComputedActivityTraces({});
      return;
    }

    const traces: Record<string, LatLng[]> = {};

    for (const section of combinedSections) {
      // Use section polyline directly (already has data from engine)
      const polyline = section.polyline || [];

      if (polyline.length < 2) continue;

      // Convert polyline to JSON for Rust engine (expects latitude/longitude)
      const polylineJson = JSON.stringify(
        polyline.map(
          (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
            latitude: p.lat ?? p.latitude ?? 0,
            longitude: p.lng ?? p.longitude ?? 0,
          })
        )
      );

      // Use Rust engine's extractSectionTrace
      const extractedTrace = routeEngine.extractSectionTrace(activityId, polylineJson);

      if (extractedTrace && extractedTrace.length > 0) {
        // Convert GpsPoint[] to LatLng format
        traces[section.id] = extractedTrace.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
        }));
      }
    }

    setComputedActivityTraces(traces);
    // Use stable string IDs instead of array references to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, engineSectionIds, customSectionIds]);

  // Determine which sections this activity holds the PR for.
  // Single FFI call instead of per-section getSectionPerformances loop.
  const prSectionIds = useMemo((): Set<string> => {
    if (!activityId) return new Set();
    const allIds = [
      ...engineSectionMatches.map((m) => m.section.id),
      ...customMatchedSections.map((s) => s.id),
    ];
    if (allIds.length === 0) return new Set();
    try {
      return new Set(routeEngine.getActivityPrSections(activityId, allIds));
    } catch {
      return new Set();
    }
  }, [engineSectionMatches, customMatchedSections, activityId]);

  // Build section overlays for map display (always computed, shown on all tabs)
  const sectionOverlays = useMemo((): SectionOverlay[] | null => {
    if (!engineSectionMatches.length && !customMatchedSections.length) return null;
    if (coordinates.length === 0) return null;

    const overlays: SectionOverlay[] = [];
    const processedIds = new Set<string>();

    // Process engine-detected sections
    for (const match of engineSectionMatches) {
      // Skip if already processed (deduplication)
      if (processedIds.has(match.section.id)) continue;
      processedIds.add(match.section.id);

      // Use section polyline directly (already has data from engine)
      const polylineSource = match.section.polyline || [];

      // Handle both RoutePoint ({lat, lng}) and GpsPoint ({latitude, longitude}) formats
      const sectionPolyline = polylineSource.map(
        (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
          latitude: p.lat ?? p.latitude ?? 0,
          longitude: p.lng ?? p.longitude ?? 0,
        })
      );

      // Try to get activity's portion from multiple sources (in order of preference):
      // 1. computedActivityTraces (extracted via engine.extractSectionTrace - most accurate)
      // 2. activityTraces from section data (pre-computed by engine)
      // 3. portion indices (slice from coordinates - least accurate)
      let activityPortion;

      // First try computed traces - these use extractSectionTrace for accuracy
      const computedTrace = computedActivityTraces[match.section.id];
      if (computedTrace && computedTrace.length > 0) {
        activityPortion = computedTrace;
      } else {
        // Try activityTraces from section data
        const activityTrace = match.section.activityTraces?.[activityId!];
        if (activityTrace && activityTrace.length > 0) {
          // Convert RoutePoint to LatLng format
          activityPortion = activityTrace.map(
            (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
              latitude: p.lat ?? p.latitude ?? 0,
              longitude: p.lng ?? p.longitude ?? 0,
            })
          );
        }
      }

      overlays.push({
        id: match.section.id,
        sectionPolyline,
        activityPortion,
        isPR: prSectionIds.has(match.section.id),
      });
    }

    // Process custom sections
    for (const section of customMatchedSections) {
      // Skip if already processed (deduplication - custom sections may appear in engine results)
      if (processedIds.has(section.id)) continue;
      processedIds.add(section.id);

      const sectionPolyline = section.polyline.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));

      // Try computed traces first (from extractSectionTrace)
      let activityPortion;
      const computedTrace = computedActivityTraces[section.id];
      if (computedTrace && computedTrace.length > 0) {
        activityPortion = computedTrace;
      } else {
        // Fall back to using indices
        const activityPortion_record = section.activityPortions?.find(
          (p) => p.activityId === activityId
        );
        if (
          activityPortion_record?.startIndex != null &&
          activityPortion_record?.endIndex != null
        ) {
          // Use portion indices from junction table
          const start = Math.max(0, activityPortion_record.startIndex);
          const end = Math.min(coordinates.length - 1, activityPortion_record.endIndex);
          if (end > start) {
            activityPortion = coordinates.slice(start, end + 1);
          }
        } else if (
          section.sourceActivityId === activityId &&
          section.startIndex != null &&
          section.endIndex != null
        ) {
          // This is the source activity - use the section's original indices
          const start = Math.max(0, section.startIndex);
          const end = Math.min(coordinates.length - 1, section.endIndex);
          if (end > start) {
            activityPortion = coordinates.slice(start, end + 1);
          }
        }
      }

      overlays.push({
        id: section.id,
        sectionPolyline,
        activityPortion,
        isPR: prSectionIds.has(section.id),
      });
    }

    // Sort overlays by where each section starts along this activity's track.
    // Keeps the map marker labels (1, 2, 3 …) aligned with the sorted section
    // list rows so row N and marker N reference the same section.
    if (coordinates.length > 0 && overlays.length > 1) {
      const findNearestIndex = (targetLat: number, targetLng: number): number => {
        let best = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < coordinates.length; i++) {
          const c = coordinates[i];
          const dLat = c.latitude - targetLat;
          const dLng = c.longitude - targetLng;
          const d = dLat * dLat + dLng * dLng;
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        return best;
      };
      const startIndexById = new Map<string, number>();
      for (const o of overlays) {
        const first = o.activityPortion?.[0] ?? o.sectionPolyline?.[0];
        if (first) startIndexById.set(o.id, findNearestIndex(first.latitude, first.longitude));
      }
      const INF = Number.MAX_SAFE_INTEGER;
      overlays.sort(
        (a, b) => (startIndexById.get(a.id) ?? INF) - (startIndexById.get(b.id) ?? INF)
      );
    }

    return overlays;
  }, [
    engineSectionMatches,
    customMatchedSections,
    coordinates,
    activityId,
    computedActivityTraces,
    prSectionIds,
  ]);

  // Helper to get activity portion as RoutePoint[] for MiniTraceView
  // Uses computed traces when available, falls back to portion indices
  const getActivityPortion = useCallback(
    (sectionId: string, portion?: { startIndex?: number; endIndex?: number }) => {
      // First try computed traces
      const computedTrace = computedActivityTraces[sectionId];
      if (computedTrace && computedTrace.length > 0) {
        return computedTrace.map((c) => ({
          lat: c.latitude,
          lng: c.longitude,
        }));
      }
      // Fall back to portion indices
      if (portion?.startIndex == null || portion?.endIndex == null) return undefined;
      const start = Math.max(0, portion.startIndex);
      const end = Math.min(coordinates.length - 1, portion.endIndex);
      if (end <= start || coordinates.length === 0) return undefined;
      return coordinates.slice(start, end + 1).map((c) => ({ lat: c.latitude, lng: c.longitude }));
    },
    [coordinates, computedActivityTraces]
  );

  return { sectionOverlays, getActivityPortion };
}

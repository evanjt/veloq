import { useMemo, useCallback } from 'react';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';
import type { SectionMatch } from '@/features/routes/hooks/useSectionMatches';
import type { Section } from '@/types';
import type { SectionEncounter } from 'veloqrs';

interface LatLng {
  latitude: number;
  longitude: number;
}

const EMPTY_SECTION_ENCOUNTERS: SectionEncounter[] = [];

/** Traces and record holders a caller already read from the engine. */
export interface PreComputedOverlays {
  /** This activity's portion of each section, keyed by section ID */
  sectionTraces: Record<string, LatLng[]>;
  /** Sections where this activity holds the record */
  prSectionIds: Set<string>;
}

interface DirectionAwareSectionOverlay extends SectionOverlay {
  /** Stable overlay key including encounter direction when available */
  overlayKey: string;
  /** Sort tie-breaker when nearest track index is the same */
  sortOrder: number;
  /** Direction used to keep forward and reverse rows distinct */
  encounterDirection?: string;
}

function makeSectionOverlayKey(sectionId: string, direction?: string): string {
  return direction == null ? sectionId : `${sectionId}|${direction}`;
}

function makeDirectionKey(encounter: { sectionId: string; direction: string }): string {
  return `${encounter.sectionId}|${encounter.direction}`;
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
  coordinates: LatLng[],
  bundle: PreComputedOverlays,
  sectionEncounters?: SectionEncounter[]
) {
  const activityTraces = bundle.sectionTraces;

  // Determine which sections this activity holds the PR for.
  // Single FFI call instead of per-section getSectionPerformances loop.
  const prSectionIds = bundle.prSectionIds;

  // Build section overlays for map display (always computed, shown on all tabs)
  const sectionOverlays = useMemo((): SectionOverlay[] | null => {
    const activeSectionEncounters = sectionEncounters ?? EMPTY_SECTION_ENCOUNTERS;
    if (!engineSectionMatches.length && !customMatchedSections.length) return null;
    if (coordinates.length === 0) return null;

    const directionToSortOrder = new Map<string, number>();
    const directionsBySection = new Map<string, string[]>();

    for (let index = 0; index < activeSectionEncounters.length; index += 1) {
      const encounter = activeSectionEncounters[index];
      const directionKey = makeDirectionKey(encounter);

      if (!directionToSortOrder.has(directionKey)) {
        directionToSortOrder.set(directionKey, index);
      }

      const directions = directionsBySection.get(encounter.sectionId);
      if (!directions) {
        directionsBySection.set(encounter.sectionId, [encounter.direction]);
      } else if (!directions.includes(encounter.direction)) {
        directions.push(encounter.direction);
      }
    }

    const overlays: DirectionAwareSectionOverlay[] = [];
    const processedIds = new Set<string>();
    let fallbackSortOrder = activeSectionEncounters.length;

    const addSectionOverlay = (
      sectionId: string,
      sectionPolyline: LatLng[],
      activityPortion?: LatLng[]
    ) => {
      const directions = directionsBySection.get(sectionId);
      const shouldSplitByDirection = directions != null && directions.length > 0;
      const sectionDirections = shouldSplitByDirection ? directions : [undefined];

      for (const direction of sectionDirections) {
        const overlayKey = makeSectionOverlayKey(sectionId, direction);
        overlays.push({
          id: sectionId,
          sectionPolyline,
          activityPortion,
          isPR: prSectionIds.has(sectionId),
          overlayKey,
          sortOrder: directionToSortOrder.get(overlayKey) ?? fallbackSortOrder++,
          encounterDirection: direction,
        });
      }
    };

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
      // 1. activityTraces (extracted by the engine - most accurate)
      // 2. activityTraces from section data (pre-computed by engine)
      // 3. portion indices (slice from coordinates - least accurate)
      let activityPortion;

      // First try computed traces - these use extractSectionTrace for accuracy
      const computedTrace = activityTraces[match.section.id];
      if (computedTrace && computedTrace.length > 0) {
        activityPortion = computedTrace;
      } else {
        // Try activityTraces from section data
        const activityTrace = activityId ? match.section.activityTraces?.[activityId] : undefined;
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

      addSectionOverlay(match.section.id, sectionPolyline, activityPortion);
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
      const computedTrace = activityTraces[section.id];
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

      addSectionOverlay(section.id, sectionPolyline, activityPortion);
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

      const startIndexByKey = new Map<string, number>();
      for (const overlay of overlays) {
        const first = overlay.activityPortion?.[0] ?? overlay.sectionPolyline?.[0];
        if (first) {
          startIndexByKey.set(
            overlay.overlayKey,
            findNearestIndex(first.latitude, first.longitude)
          );
        }
      }

      const INF = Number.MAX_SAFE_INTEGER;
      overlays.sort((a, b) => {
        const aIndex = startIndexByKey.get(a.overlayKey) ?? INF;
        const bIndex = startIndexByKey.get(b.overlayKey) ?? INF;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.sortOrder - b.sortOrder;
      });
    }

    return overlays;
  }, [
    engineSectionMatches,
    customMatchedSections,
    coordinates,
    activityId,
    activityTraces,
    prSectionIds,
    sectionEncounters,
  ]);

  // Helper to get activity portion as RoutePoint[] for MiniTraceView
  // Uses computed traces when available, falls back to portion indices
  const getActivityPortion = useCallback(
    (sectionId: string, portion?: { startIndex?: number; endIndex?: number }) => {
      // First try computed traces
      const computedTrace = activityTraces[sectionId];
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
    [coordinates, activityTraces]
  );

  return { sectionOverlays, getActivityPortion };
}

import { useMemo } from 'react';
import { type SectionOverlay } from '@/features/maps';
import type { SectionMatch } from '@/features/routes';
import type { Section } from '@/types';
import type { SectionEncounter } from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';

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
  /** Position of the overlay's encounter in the engine's track order */
  sortOrder: number;
  /** Direction used to keep forward and reverse rows distinct */
  encounterDirection?: string | undefined;
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
 * with overlay building for map display. Overlays are computed on every tab.
 */
export function useSectionOverlays(
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
    const prDirections = new Set<string>();

    for (let index = 0; index < activeSectionEncounters.length; index += 1) {
      const encounter = activeSectionEncounters[index];
      const directionKey = makeDirectionKey(encounter);
      if (encounter.isPr) prDirections.add(directionKey);

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
          isPR: direction == null ? prSectionIds.has(sectionId) : prDirections.has(overlayKey),
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

      // The engine's extracted trace is the most accurate portion.
      const computedTrace = activityTraces[match.section.id];
      const activityPortion = computedTrace && computedTrace.length > 0 ? computedTrace : undefined;

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

    // The engine returns encounters ordered by where each starts along this
    // activity's track, and sortOrder is that position, so row N and marker N
    // name the same section. Overlays with no encounter follow in arrival order.
    overlays.sort((a, b) => a.sortOrder - b.sortOrder);

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

  return { sectionOverlays };
}

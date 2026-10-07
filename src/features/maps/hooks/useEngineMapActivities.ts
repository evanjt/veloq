/** Map activities and filter counts from one Rust screen read. */
import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { LatLngShort } from '@/shared/geo/distance';
import type { ActivityBoundsItem } from '@/types';
import { decodeCoords, type MapDistanceBand } from 'veloqrs';
import type { RouteLineLayerInput } from '@/features/maps/lib/routeLineCollection';

export interface MapSection {
  id: string;
  name: string;
  visitCount: number;
  distanceMeters: number;
  polyline: LatLngShort[];
}

interface UseEngineMapActivitiesOptions {
  /** Start of date range filter */
  startDate: Date;
  /** End of date range filter */
  endDate: Date;
  /** Sport types to include (empty = all types) */
  selectedTypes: Set<string>;
  /** Distance band in the current unit system */
  distanceBand: MapDistanceBand;
  /** Whether distances use metric band edges */
  isMetric: boolean;
  /** Text the activity name must contain, ignoring case. Empty matches all. */
  nameNeedle?: string;
  /** Whether the read carries the route-line layer */
  showRoutes?: boolean;
  showSections?: boolean;
  /** Route matching is on; off, the read carries no section count or overlay */
  sectionsEnabled?: boolean;
  /** Whether to enable the hook (allows conditional usage) */
  enabled?: boolean;
}

interface UseEngineMapActivitiesReturn {
  /** Filtered activities ready for map rendering */
  activities: ActivityBoundsItem[];
  /** Total activities in engine (unfiltered count) */
  totalCount: number;
  /** Available sport types from engine data */
  availableTypes: string[];
  /** Counts in the date window, before sport and distance filters */
  categoryCounts: { category: string; count: number }[];
  /** Routes the map can draw, whether or not the layer was asked for */
  routeCount: number;
  /** The route-line layer, present only when asked for and current */
  routeLines: RouteLineLayerInput | undefined;
  sectionCount: number;
  sections: MapSection[];
}

/** Get the map's filtered activities and unfiltered chip counts. */
export function useEngineMapActivities({
  startDate,
  endDate,
  selectedTypes,
  distanceBand,
  isMetric,
  nameNeedle = '',
  showRoutes = false,
  showSections = true,
  sectionsEnabled = true,
  enabled = true,
}: UseEngineMapActivitiesOptions): UseEngineMapActivitiesReturn {
  // The reader carries the subscription: its identity changes when the channel
  // fires and at no other time, so the memo below reads it and re-runs then.
  const readEngine = useEngineRead(['activities', 'groups', 'sections']);

  // One call: engine total, sport types and the filtered activities.
  const {
    activities,
    availableTypes,
    activityCount,
    categoryCounts,
    routeCount,
    routeLines,
    sectionCount,
    sections,
  } = useMemo(() => {
    const empty = {
      activities: [],
      availableTypes: [],
      activityCount: 0,
      categoryCounts: [],
      routeCount: 0,
      routeLines: undefined,
      sectionCount: 0,
      sections: [],
    };
    if (!enabled) return empty;

    const sportTypesArray = Array.from(selectedTypes);
    const data = readEngine((engine) =>
      engine.getMapScreenData(
        startDate,
        endDate,
        sportTypesArray,
        distanceBand,
        isMetric,
        showRoutes,
        showSections && sectionsEnabled,
        nameNeedle
      )
    );
    if (!data) return empty;

    // Convert to ActivityBoundsItem format
    const items: ActivityBoundsItem[] = data.activities.map((a) => ({
      id: a.activityId,
      bounds: [
        [a.bounds.minLat, a.bounds.minLng],
        [a.bounds.maxLat, a.bounds.maxLng],
      ],
      type: a.sportType as ActivityBoundsItem['type'],
      name: a.name,
      isVirtual: a.isVirtual,
      // Convert Unix timestamp in seconds to ISO string.
      date: new Date(Number(a.date) * 1000).toISOString(),
      distance: a.distance,
      duration: a.duration,
      startPoint:
        a.startLat !== null &&
        a.startLat !== undefined &&
        a.startLng !== null &&
        a.startLng !== undefined
          ? ([a.startLat, a.startLng] as [number, number])
          : undefined,
    }));

    return {
      activities: items,
      availableTypes: data.availableSportTypes,
      activityCount: data.activityCount,
      categoryCounts: data.categoryCounts,
      routeCount: data.routeCount,
      routeLines: data.routeLines,
      sectionCount: sectionsEnabled ? data.sectionCount : 0,
      sections: (sectionsEnabled ? (data.sections ?? []) : []).map((section) => ({
        id: section.id,
        name: section.name ?? '',
        visitCount: section.visitCount,
        distanceMeters: section.distanceMeters,
        polyline: decodeCoords(section.encodedPolyline).map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
        })),
      })),
    };
  }, [
    enabled,
    readEngine,
    startDate,
    endDate,
    selectedTypes,
    distanceBand,
    isMetric,
    showRoutes,
    showSections,
    sectionsEnabled,
    nameNeedle,
  ]);

  return {
    activities,
    totalCount: activityCount,
    availableTypes,
    categoryCounts,
    routeCount,
    routeLines,
    sectionCount,
    sections,
  };
}

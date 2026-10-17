/** Map activities and filter counts from one Rust screen read. */
import { useCallback, useMemo, useState } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { ActivityBoundsItem } from '@/types';
import type { FfiMapEmptyReason, FfiRouteLineLayer, MapDistanceBand } from 'veloqrs';
import type { RouteLineLayerInput } from '@/features/maps/lib/routeLineCollection';
import { createLayerHold } from '@/features/maps/lib/mapLayerHold';
import { createSectionLineCache, type MapSection } from '@/features/maps/lib/sectionLineCollection';
import { fromEngineSportFamily } from '@/shared/activity/engineSportFamily';
import type { SportFamily } from '@/shared/activity/sportCategories';

export type { MapSection } from '@/features/maps/lib/sectionLineCollection';

/** A route-line layer that carries its lines rather than leaving them with the caller. */
function carriesRoutes(layer: FfiRouteLineLayer): layer is FfiRouteLineLayer & RouteLineLayerInput {
  return layer.routes !== undefined;
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
  categoryCounts: { category: SportFamily; count: number }[];
  /** Routes the map can draw, whether or not the layer was asked for */
  routeCount: number;
  /** The route-line layer, present only when asked for and current */
  routeLines: RouteLineLayerInput | undefined;
  sectionCount: number;
  sections: MapSection[];
  /** The overlay's lines, the same object while the engine's stamp is unchanged */
  sectionsGeoJSON: GeoJSON.FeatureCollection;
  /** Why the map draws no activity, as the engine names it; undefined while it draws one */
  emptyReason: FfiMapEmptyReason | undefined;
  /** The screen read threw, so nothing above describes the library */
  isError: boolean;
  /** What the screen read threw, when it did */
  error: unknown;
  /** Read again, after a failure */
  refetch: () => void;
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
  // What the last read decoded of each layer. Its stamp goes back with the next read, so
  // a filter change is answered without the layers and hands back the same objects.
  const [routeHold] = useState(() =>
    createLayerHold<FfiRouteLineLayer, RouteLineLayerInput | undefined>(undefined, (layer) =>
      carriesRoutes(layer) ? layer : undefined
    )
  );
  const [sectionCache] = useState(createSectionLineCache);
  // A retry has no announcement to wait for, so it moves its own generation.
  const [retries, setRetries] = useState(0);
  const refetch = useCallback(() => setRetries((n) => n + 1), []);

  // One call: engine total, sport types and the filtered activities.
  const {
    activities,
    availableTypes,
    activityCount,
    categoryCounts,
    routeCount,
    routeLines,
    sectionCount,
    sectionOverlay,
    emptyReason,
    isError,
    error,
  } = useMemo(() => {
    void retries;
    // Built only when there is nothing to show, since it lets go of the held layers.
    const empty = () => ({
      isError: false,
      error: undefined as unknown,
      activities: [],
      availableTypes: [],
      activityCount: 0,
      categoryCounts: [],
      routeCount: 0,
      routeLines: routeHold.take(undefined),
      sectionCount: 0,
      sectionOverlay: sectionCache.overlay(undefined),
      emptyReason: undefined as FfiMapEmptyReason | undefined,
    });
    if (!enabled) return empty();

    const sportTypesArray = Array.from(selectedTypes);
    let data;
    try {
      data = readEngine((engine) =>
        engine.getMapScreenData(
          startDate,
          endDate,
          sportTypesArray,
          distanceBand,
          isMetric,
          showRoutes,
          showSections && sectionsEnabled,
          nameNeedle,
          routeHold.stamp(),
          sectionCache.stamp()
        )
      );
    } catch (readError) {
      return { ...empty(), isError: true, error: readError };
    }
    if (!data) return empty();

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
      isError: false,
      error: undefined,
      activities: items,
      availableTypes: data.availableSportTypes,
      activityCount: data.activityCount,
      categoryCounts: data.categoryCounts.map(({ family, count }) => ({
        category: fromEngineSportFamily(family),
        count,
      })),
      routeCount: data.routeCount,
      routeLines: routeHold.take(data.routeLines),
      sectionCount: sectionsEnabled ? data.sectionCount : 0,
      sectionOverlay: sectionCache.overlay(sectionsEnabled ? data.sections : undefined),
      emptyReason: data.emptyReason,
    };
  }, [
    enabled,
    routeHold,
    sectionCache,
    retries,
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
    sections: sectionOverlay.sections,
    sectionsGeoJSON: sectionOverlay.collection,
    emptyReason,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook for iOS-specific tap handling on the regional map.
 * Uses queryRenderedFeaturesAtPoint for O(1) hit detection on
 * activity markers, section lines, and route lines.
 *
 * Returns undefined handlers on Android (Android uses ShapeSource.onPress).
 */

import { useCallback, useRef } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import type { Camera, MapViewRef, ShapeSource } from '@maplibre/maplibre-react-native';
import type { ActivityBoundsItem, FrequentSection, ActivityType } from '@/types';
import type { SelectedActivity } from './ActivityPopup';
import type { SelectedRoute } from './types';
import type { SpiderState } from './useMapHandlers';

interface UseIOSTapHandlerOptions {
  mapRef: React.RefObject<MapViewRef | null>;
  activities: ActivityBoundsItem[];
  sections: FrequentSection[];
  routeGroups: {
    id: string;
    name: string;
    activityCount: number;
    sportType: string;
    type: ActivityType;
    bestTime?: number;
  }[];
  selected: SelectedActivity | null;
  selectedSection: FrequentSection | null;
  selectedRoute: SelectedRoute | null;
  setSelected: (v: SelectedActivity | null) => void;
  setSelectedSection: (v: FrequentSection | null) => void;
  setSelectedRoute: (v: SelectedRoute | null) => void;
  showActivities: boolean;
  showSections: boolean;
  showRoutes: boolean;
  show3D: boolean;
  handleMarkerTap: (activity: ActivityBoundsItem) => void;
  clusterSourceRef: React.RefObject<React.ElementRef<typeof ShapeSource> | null>;
  cameraRef: React.RefObject<React.ElementRef<typeof Camera> | null>;
  currentZoomLevel: React.MutableRefObject<number>;
  insetTop: number;
  spider: SpiderState | null;
  setSpider: (state: SpiderState | null) => void;
}

interface UseIOSTapHandlerResult {
  onTouchStart: ((e: GestureResponderEvent) => void) | undefined;
  onTouchEnd: ((e: GestureResponderEvent) => void) | undefined;
}

// Rate limit iOS taps to prevent race conditions that can crash MapLibre
const TAP_DEBOUNCE_MS = 100;

export function useIOSTapHandler({
  mapRef,
  activities,
  sections,
  routeGroups,
  selected,
  selectedSection,
  selectedRoute,
  setSelected,
  setSelectedSection,
  setSelectedRoute,
  showActivities,
  showSections,
  showRoutes,
  show3D,
  handleMarkerTap,
  clusterSourceRef,
  cameraRef,
  currentZoomLevel,
  insetTop,
  spider,
  setSpider,
}: UseIOSTapHandlerOptions): UseIOSTapHandlerResult {
  const lastTapTimeRef = useRef<number>(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // iOS tap handler - uses queryRenderedFeaturesAtPoint for O(1) hit detection
  // Queries activity markers, section lines, and route lines based on visibility toggles
  const handleiOSTap = useCallback(
    async (screenX: number, screenY: number) => {
      // Rate limiting: ignore taps that are too close together
      const now = Date.now();
      if (now - lastTapTimeRef.current < TAP_DEBOUNCE_MS) {
        return;
      }
      lastTapTimeRef.current = now;

      // Wrap in try-catch to prevent unhandled errors from crashing the app
      try {
        // Defensive check: ensure map ref is valid before querying
        if (!mapRef.current) {
          return;
        }

        const zoom = currentZoomLevel.current;
        // Expand query rect based on zoom (matches CircleLayer radius interpolation)
        // Use different hit radius for points vs lines - lines are thin and need bigger area
        // Matches CircleLayer: zoom 0→16, 4→14, 8→12, 12→8, 16→6
        const pointHitRadius = zoom < 4 ? 16 : zoom < 8 ? 14 : zoom < 12 ? 12 : zoom < 16 ? 8 : 6;
        // Lines need 3x the hit area since they're only a few pixels wide
        const lineHitRadius = Math.max(pointHitRadius * 3, 20); // Minimum 20px for lines

        // Build list of layers to query based on visibility
        const layersToQuery: string[] = [];
        // Spider markers take priority — query them first so they are hit-tested before clusters
        if (spider) {
          layersToQuery.push('spider-points');
        }
        if (showActivities) {
          layersToQuery.push('cluster-circles', 'unclustered-point');
        }
        if (showSections) layersToQuery.push('sectionsLine');
        if (showRoutes) layersToQuery.push('routesLine');

        if (layersToQuery.length === 0) {
          if (selected) setSelected(null);
          if (selectedSection) setSelectedSection(null);
          if (selectedRoute) setSelectedRoute(null);
          return;
        }

        // Use line hit radius if querying any line layers (sections or routes)
        const hasLineLayer = showSections || showRoutes;
        const hitRadius = hasLineLayer ? lineHitRadius : pointHitRadius;
        const bbox: [number, number, number, number] = [
          screenX - hitRadius,
          screenY - hitRadius,
          screenX + hitRadius,
          screenY + hitRadius,
        ];

        // Try queryRenderedFeaturesAtPoint first (more reliable for single taps on iOS)
        // Then fall back to queryRenderedFeaturesInRect with expanded bbox
        let features = await mapRef.current?.queryRenderedFeaturesAtPoint(
          [screenX, screenY],
          undefined,
          layersToQuery
        );

        // If no hit at point, try with expanded bbox
        if (!features || features.features.length === 0) {
          features = await mapRef.current?.queryRenderedFeaturesInRect(
            bbox,
            undefined,
            layersToQuery
          );
        }

        if (features && features.features.length > 0) {
          // Process the first feature found (closest to tap point due to bbox query)
          const feature = features.features[0];
          const featureId = feature.properties?.id;

          // Spider marker tap — select the activity and dismiss spider
          if (feature.properties?.isSpider === true && featureId) {
            const activity = activities.find((a) => a.id === featureId);
            if (activity) {
              setSpider(null);
              handleMarkerTap(activity);
              return;
            }
          }

          // Determine feature type by checking geometry and properties
          if (feature.geometry?.type === 'Point' && showActivities) {
            // Cluster tap — zoom in or spider-expand at max zoom
            if (feature.properties?.cluster === true) {
              try {
                if (clusterSourceRef.current) {
                  const expansionZoom =
                    await clusterSourceRef.current.getClusterExpansionZoom(feature);
                  const coords = (feature.geometry as GeoJSON.Point).coordinates as [
                    number,
                    number,
                  ];
                  const currentZoom = currentZoomLevel.current;

                  // At max zoom, fan out into spider pattern
                  if (expansionZoom >= 17 || currentZoom >= 16) {
                    const pointCount = feature.properties?.point_count ?? 0;
                    const leaves = await clusterSourceRef.current.getClusterLeaves(
                      feature,
                      Math.min(pointCount, 50),
                      0
                    );
                    if (leaves.features.length > 0) {
                      setSpider({ center: coords, leaves: leaves.features });
                    }
                    return;
                  }

                  cameraRef.current?.setCamera({
                    centerCoordinate: coords,
                    zoomLevel: expansionZoom,
                    animationDuration: 400,
                    animationMode: 'flyTo',
                  });
                }
              } catch (e) {
                if (__DEV__) console.warn('[iOS tap] cluster error:', e);
              }
              return;
            }

            // Individual activity marker hit
            const activity = activities.find((a) => a.id === featureId);
            if (activity) {
              console.log('[iOS tap] HIT activity:', featureId);
              handleMarkerTap(activity);
              return;
            }
          } else if (feature.geometry?.type === 'LineString') {
            // Could be section or route - check properties to determine
            if (feature.properties?.visitCount !== undefined && showSections) {
              // Section hit (has visitCount property)
              const section = sections.find((s) => s.id === featureId);
              if (section) {
                console.log('[iOS tap] HIT section:', featureId);
                setSelectedSection(section);
                setSelected(null);
                setSelectedRoute(null);
                return;
              }
            } else if (feature.properties?.activityCount !== undefined && showRoutes) {
              // Route hit (has activityCount property)
              const route = routeGroups.find((g) => g.id === featureId);
              if (route) {
                console.log('[iOS tap] HIT route:', featureId);
                setSelectedRoute({
                  id: route.id,
                  name: route.name,
                  activityCount: route.activityCount,
                  sportType: route.sportType,
                  type: route.type,
                  bestTime: route.bestTime,
                });
                setSelected(null);
                setSelectedSection(null);
                return;
              }
            }
          }
        }

        // No hit - clear appropriate selections
        if (selected) setSelected(null);
        if (selectedSection) setSelectedSection(null);
        if (selectedRoute) setSelectedRoute(null);
        if (spider) setSpider(null);
      } catch (error) {
        // Log error but don't crash - gracefully handle MapLibre query failures
        if (__DEV__) {
          console.warn('[iOS tap] Error during tap handling:', error);
        }
      }
    },
    [
      activities,
      sections,
      routeGroups,
      handleMarkerTap,
      selected,
      setSelected,
      selectedSection,
      setSelectedSection,
      selectedRoute,
      setSelectedRoute,
      showActivities,
      showSections,
      showRoutes,
      currentZoomLevel,
      mapRef,
      clusterSourceRef,
      cameraRef,
      spider,
      setSpider,
    ]
  );

  // Android uses ShapeSource.onPress — no touch handlers needed
  if (Platform.OS !== 'ios') {
    return { onTouchStart: undefined, onTouchEnd: undefined };
  }

  const onTouchStart = (e: GestureResponderEvent) => {
    touchStartRef.current = {
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
      time: Date.now(),
    };
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = touchStartRef.current;
    if (!start) return;

    const dx = Math.abs(e.nativeEvent.locationX - start.x);
    const dy = Math.abs(e.nativeEvent.locationY - start.y);
    const duration = Date.now() - start.time;

    // Only treat as tap if: short duration, minimal movement, not in button area
    const isTap = duration < 300 && dx < 10 && dy < 10;
    const isInMapArea = e.nativeEvent.locationY > insetTop + 60; // Below buttons

    if (isTap && isInMapArea && !show3D) {
      handleiOSTap(e.nativeEvent.locationX, e.nativeEvent.locationY);
    }
    touchStartRef.current = null;
  };

  return { onTouchStart, onTouchEnd };
}

import { useCallback, useMemo } from 'react';
import { decodeCoords, routes } from 'veloqrs';

import { useRecordingLiveStore, type NearbyRouteView } from '@/features/recording';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { ActivityType } from '@/types';

export type { NearbyRouteView };

interface NearbyRouteOverlayInput {
  activityType: ActivityType;
  location: { latitude: number; longitude: number } | null;
  /** False for a sport with no map, which draws and offers nothing. */
  enabled: boolean;
}

/** A fix is read again once it has moved by about this fraction of a degree (110 m). */
const FIX_GRID_DEGREES = 1000;

/**
 * The saved routes around the athlete and the one they follow. The engine returns the routes
 * within reach of the fix, nearest first, with each one's length, best time and line; nothing is
 * followed until the athlete chooses. A choice, "no route" included, holds for that sport from
 * the entry screen through the ride, and is described by the same read wherever the route lies.
 */
export function useNearbyRouteOverlay({
  activityType,
  location,
  enabled,
}: NearbyRouteOverlayInput) {
  const choice = useRecordingLiveStore((s) => s.routeChoice);
  const setRouteChoice = useRecordingLiveStore((s) => s.setRouteChoice);
  const followedRouteId = choice && choice.activityType === activityType ? choice.routeId : null;

  const readGroups = useEngineRead(['groups']);
  const latitude = location
    ? Math.round(location.latitude * FIX_GRID_DEGREES) / FIX_GRID_DEGREES
    : null;
  const longitude = location
    ? Math.round(location.longitude * FIX_GRID_DEGREES) / FIX_GRID_DEGREES
    : null;

  const nearby = useMemo<NearbyRouteView[]>(() => {
    if (!enabled || latitude === null || longitude === null) return [];
    const rows =
      readGroups(() =>
        routes.getNearbyRoutesForRecording(
          latitude,
          longitude,
          activityType,
          followedRouteId ?? undefined
        )
      ) ?? [];
    return rows.map((row) => ({
      id: row.groupId,
      name: row.name,
      distanceMeters: row.distanceMeters,
      bestTimeSeconds: row.bestTimeSeconds ?? null,
      points: decodeCoords(row.encodedCoords).map((p) => ({ lat: p.latitude, lng: p.longitude })),
    }));
  }, [enabled, latitude, longitude, activityType, followedRouteId, readGroups]);

  const followed = useMemo(
    () => (enabled ? (nearby.find((route) => route.id === followedRouteId) ?? null) : null),
    [enabled, nearby, followedRouteId]
  );
  const choose = useCallback(
    (routeId: string | null) => setRouteChoice(activityType, routeId),
    [setRouteChoice, activityType]
  );
  const stopFollowing = useCallback(() => choose(null), [choose]);

  return { nearby, followed, followedRouteId, choose, stopFollowing };
}

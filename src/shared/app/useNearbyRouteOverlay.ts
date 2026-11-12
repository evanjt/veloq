import { useCallback, useEffect, useMemo } from 'react';
import { decodeCoords, routes } from 'veloqrs';

import {
  useRecordingLiveStore,
  useRecordingStore,
  type NearbyRouteView,
} from '@/features/recording';
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
 * the entry screen through the ride, and is described by the same read wherever the route lies
 * once the ride is recording. Before the start, a remembered route beyond the radius of the fix
 * is stale: it is neither offered nor drawn, and the choice is forgotten.
 */
export function useNearbyRouteOverlay({
  activityType,
  location,
  enabled,
}: NearbyRouteOverlayInput) {
  const choice = useRecordingLiveStore((s) => s.routeChoice);
  const setRouteChoice = useRecordingLiveStore((s) => s.setRouteChoice);
  const recording = useRecordingStore((s) => s.status !== 'idle');
  const chosenRouteId = choice && choice.activityType === activityType ? choice.routeId : null;

  const readGroups = useEngineRead(['groups']);
  const latitude = location
    ? Math.round(location.latitude * FIX_GRID_DEGREES) / FIX_GRID_DEGREES
    : null;
  const longitude = location
    ? Math.round(location.longitude * FIX_GRID_DEGREES) / FIX_GRID_DEGREES
    : null;

  const rows = useMemo(() => {
    if (!enabled || latitude === null || longitude === null) return [];
    const read =
      readGroups(() =>
        routes.getNearbyRoutesForRecording(
          latitude,
          longitude,
          activityType,
          chosenRouteId ?? undefined
        )
      ) ?? [];
    return read;
  }, [enabled, latitude, longitude, activityType, chosenRouteId, readGroups]);

  const stale =
    !recording &&
    chosenRouteId !== null &&
    rows.some((row) => row.groupId === chosenRouteId && !row.offered);
  const followedRouteId = stale ? null : chosenRouteId;
  useEffect(() => {
    if (stale) setRouteChoice(activityType, null);
  }, [stale, setRouteChoice, activityType]);

  const nearby = useMemo<NearbyRouteView[]>(() => {
    return rows
      .filter((row) => row.offered || (recording && row.groupId === chosenRouteId))
      .map((row) => ({
        id: row.groupId,
        name: row.name,
        distanceMeters: row.distanceMeters,
        bestTimeSeconds: row.bestTimeSeconds ?? null,
        points: decodeCoords(row.encodedCoords).map((p) => ({ lat: p.latitude, lng: p.longitude })),
      }));
  }, [rows, recording, chosenRouteId]);

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

import { useCallback, useMemo } from 'react';

import { nearbyRouteIds, useRecordingLiveStore } from '@/features/recording';
import { useRepresentativeRoute } from '@/features/routes';
import { useRouteGroups } from '@/features/routes/light';
import type { ActivityType } from '@/types';

interface NearbyRouteOverlayInput {
  activityType: ActivityType;
  location: { latitude: number; longitude: number } | null;
  /** False for a sport with no map, which draws and offers nothing. */
  enabled: boolean;
  /** True until a ride is under way: only then is the nearest route drawn unasked. */
  idle: boolean;
}

/**
 * The saved route drawn on the recording map and the nearby ones the picker lists first.
 * Until the athlete chooses, the nearest route to the fix is drawn while nothing is recorded;
 * an explicit choice, "no route" included, holds for that sport from the entry screen through
 * the ride.
 */
export function useNearbyRouteOverlay({
  activityType,
  location,
  enabled,
  idle,
}: NearbyRouteOverlayInput) {
  const { groups } = useRouteGroups({ type: activityType, minActivities: 2, sortBy: 'count' });
  const choice = useRecordingLiveStore((s) => s.routeChoice);
  const setRouteChoice = useRecordingLiveStore((s) => s.setRouteChoice);

  const nearby = useMemo(
    () => (enabled ? nearbyRouteIds(groups, location) : []),
    [enabled, groups, location]
  );
  const chosen = choice && choice.activityType === activityType ? choice : null;
  const overlayRouteId = !enabled
    ? null
    : chosen
      ? chosen.routeId
      : idle
        ? (nearby[0] ?? null)
        : null;
  const { points: overlayPoints } = useRepresentativeRoute(overlayRouteId);
  const choose = useCallback(
    (routeId: string | null) => setRouteChoice(activityType, routeId),
    [setRouteChoice, activityType]
  );

  return { overlayRouteId, overlayPoints, nearbyRouteIds: nearby, choose };
}

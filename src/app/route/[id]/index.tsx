import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { RouteDetailCard, RouteDetailMap } from '@/features/routes';
import { MapSheetHostMap, useMapSheetHost } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The route's map, filling the window under the sheet it presents, or beside its side panel. */
function RouteMapScreen() {
  const host = useMapSheetHost();
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const id = host?.id ?? '';
  return (
    <MapSheetHostMap panel={<RouteDetailCard id={id} activityId={activityId} />}>
      <RouteDetailMap routeId={id} pageActivityId={activityId} />
    </MapSheetHostMap>
  );
}

export default withScreenBoundary(RouteMapScreen, 'Route Map');

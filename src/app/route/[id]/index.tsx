import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack, DetailMapHost } from '@/features/routes';
import { MapSheetHostMap } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/**
 * The route's map, filling the window under the sheet it presents, or beside its side panel. The
 * map follows the card on top of the sheet, the route's own at first.
 */
function RouteMapScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const rootParams = useMemo(() => ({ activityId }), [activityId]);
  return (
    <MapSheetHostMap panel={<DetailCardStack rootParams={rootParams} />}>
      <DetailMapHost rootParams={rootParams} />
    </MapSheetHostMap>
  );
}

export default withScreenBoundary(RouteMapScreen, 'Route Map');

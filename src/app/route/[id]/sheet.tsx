import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack } from '@/features/routes';
import { MapSheetHostSheet } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The route's sheet, holding the route's card and any card a row in it opens over it. */
function RouteSheetScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const rootParams = useMemo(() => ({ activityId }), [activityId]);
  return (
    <MapSheetHostSheet>
      <DetailCardStack rootParams={rootParams} />
    </MapSheetHostSheet>
  );
}

export default withScreenBoundary(RouteSheetScreen, 'Route Detail');

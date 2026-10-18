import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { RouteDetailCard } from '@/features/routes';
import { MapSheetHostSheet } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The route's sheet, holding the route's card. */
function RouteSheetScreen() {
  const { id, activityId } = useLocalSearchParams<{ id: string; activityId?: string }>();
  return (
    <MapSheetHostSheet>
      <RouteDetailCard id={id} activityId={activityId} />
    </MapSheetHostSheet>
  );
}

export default withScreenBoundary(RouteSheetScreen, 'Route Detail');

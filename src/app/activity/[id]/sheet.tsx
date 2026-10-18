import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack } from '@/features/routes';
import { MapSheetHostSheet } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The activity's sheet, holding the activity's card and any card a row in it opens over it. */
function ActivitySheetScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const rootParams = useMemo(() => ({ tab }), [tab]);
  return (
    <MapSheetHostSheet>
      <DetailCardStack rootParams={rootParams} />
    </MapSheetHostSheet>
  );
}

export default withScreenBoundary(ActivitySheetScreen, 'Activity Detail');

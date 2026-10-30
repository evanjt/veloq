import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DetailCardStack, DetailMapHost } from '@/features/routes';
import { MapSheetHostMap } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/**
 * The section's map, filling the window under the sheet it presents, or beside its side panel.
 * The map follows the card on top of the sheet, the section's own at first.
 */
function SectionMapScreen() {
  const { activityId, previewVersion, origin } = useLocalSearchParams<{
    activityId?: string;
    previewVersion?: string;
    origin?: string;
  }>();
  const rootParams = useMemo(
    () => ({ activityId, previewVersion, origin }),
    [activityId, previewVersion, origin]
  );
  return (
    <MapSheetHostMap panel={<DetailCardStack rootParams={rootParams} />}>
      <DetailMapHost rootParams={rootParams} />
    </MapSheetHostMap>
  );
}

export default withScreenBoundary(SectionMapScreen, 'Section Map');

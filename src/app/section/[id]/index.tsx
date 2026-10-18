import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SectionDetailCard, SectionDetailMap } from '@/features/routes';
import { MapSheetHostMap, useMapSheetHost } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The section's map, filling the window under the sheet it presents, or beside its side panel. */
function SectionMapScreen() {
  const host = useMapSheetHost();
  const { activityId, previewVersion } = useLocalSearchParams<{
    activityId?: string;
    previewVersion?: string;
  }>();
  const id = host?.id ?? '';
  return (
    <MapSheetHostMap panel={<SectionDetailCard id={id} activityId={activityId} />}>
      <SectionDetailMap
        sectionId={id}
        pageActivityId={activityId}
        previewVersion={previewVersion}
      />
    </MapSheetHostMap>
  );
}

export default withScreenBoundary(SectionMapScreen, 'Section Map');

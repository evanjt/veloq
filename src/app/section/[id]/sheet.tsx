import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SectionDetailCard } from '@/features/routes';
import { MapSheetHostSheet } from '@/shared/app/MapSheetHost';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The section's sheet, holding the section's card. */
function SectionSheetScreen() {
  const { id, activityId } = useLocalSearchParams<{ id: string; activityId?: string }>();
  return (
    <MapSheetHostSheet>
      <SectionDetailCard id={id} activityId={activityId} />
    </MapSheetHostSheet>
  );
}

export default withScreenBoundary(SectionSheetScreen, 'Section Detail');

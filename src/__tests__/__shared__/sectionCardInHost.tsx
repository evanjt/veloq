/**
 * The section's card as its sheet screen renders it, inside a host whose entry is open while it
 * is mounted and whose header options are handed to `onHeaderOptions`, for a suite that renders
 * the card without the navigators.
 */
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SectionDetailCard } from '@/features/routes/screens/SectionDetailCard';
import {
  MapSheetHostContext,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';

export function sectionCardInHost(onHeaderOptions: (options: object) => void = () => {}) {
  return function SectionCardInHost() {
    const { id, activityId } = useLocalSearchParams<{ id: string; activityId?: string }>();
    const key = useMapSheetHostEntry('section', id);
    const host = useMemo<MapSheetHostValue>(
      () => ({
        kind: 'section',
        id,
        key,
        focused: true,
        setHeaderOptions: onHeaderOptions,
      }),
      [id, key]
    );
    return (
      <MapSheetHostContext.Provider value={host}>
        <SectionDetailCard id={id} activityId={activityId} />
      </MapSheetHostContext.Provider>
    );
  };
}

/**
 * The section's card as its sheet screen renders it, inside a host whose entry is open while it
 * is mounted and whose header options are handed to `onHeaderOptions`, for a suite that renders
 * the card without the navigators. With `inSheet`, the card sits in the host's sheet screen, the
 * fill and Android's drawn handle around it, which needs `useNavigation` from `expo-router`.
 */
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SectionDetailCard } from '@/features/routes/screens/SectionDetailCard';
import {
  MapSheetHostContext,
  MapSheetHostSheet,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';

export function sectionCardInHost(
  onHeaderOptions: (options: object) => void = () => {},
  { inSheet = false }: { inSheet?: boolean } = {}
) {
  return function SectionCardInHost() {
    const { id, activityId, origin } = useLocalSearchParams<{
      id: string;
      activityId?: string;
      origin?: string;
    }>();
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
        {inSheet ? (
          <MapSheetHostSheet>
            <SectionDetailCard id={id} activityId={activityId} origin={origin} />
          </MapSheetHostSheet>
        ) : (
          <SectionDetailCard id={id} activityId={activityId} origin={origin} />
        )}
      </MapSheetHostContext.Provider>
    );
  };
}

/**
 * The route's card as its sheet screen renders it, inside a host whose entry is open while it is
 * mounted and whose header options are handed to `onHeaderOptions`, for a suite that renders the
 * card without the navigators. With `inSheet`, the card sits in the host's sheet screen, the
 * fill and Android's drawn handle around it, which needs `useNavigation` from `expo-router`.
 */
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { RouteDetailCard } from '@/features/routes/screens/RouteDetailCard';
import {
  MapSheetHostContext,
  MapSheetHostSheet,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';

export function routeCardInHost(
  onHeaderOptions: (options: object) => void = () => {},
  { inSheet = false }: { inSheet?: boolean } = {}
) {
  return function RouteCardInHost() {
    const { id, activityId } = useLocalSearchParams<{ id: string; activityId?: string }>();
    const key = useMapSheetHostEntry('route', id);
    const host = useMemo<MapSheetHostValue>(
      () => ({
        kind: 'route',
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
            <RouteDetailCard id={id} activityId={activityId} />
          </MapSheetHostSheet>
        ) : (
          <RouteDetailCard id={id} activityId={activityId} />
        )}
      </MapSheetHostContext.Provider>
    );
  };
}

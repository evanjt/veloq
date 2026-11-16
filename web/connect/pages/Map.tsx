// The map page: the library's activities, routes and sections on one map.

import { MapScreen } from '../map/MapScreen';
import { useQueries } from '../useRead';
import type { PageProps } from './types';

export function MapPage({ snapshot, route }: PageProps) {
  const { state } = snapshot;
  const queries = useQueries();
  return (
    <MapScreen
      queries={queries}
      methods={state.name === 'connected' ? (state.methods ?? []) : []}
      route={route}
    />
  );
}

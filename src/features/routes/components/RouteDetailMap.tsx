import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { RouteMapView } from './RouteMapView';
import { MAP_HEIGHT, styles } from './RouteDetailScreen.styles';
import type { buildFinalRouteGroup } from '../lib/buildRouteGroup';
import type { RoutePoint } from '../types';

type FinalRouteGroup = NonNullable<ReturnType<typeof buildFinalRouteGroup>>;

interface RouteDetailMapProps {
  routeGroup: FinalRouteGroup;
  highlightedActivityId: string | null;
  highlightedActivityPoints: RoutePoint[] | undefined;
  signatures: Record<string, { points: Array<{ lat: number; lng: number }> }>;
  hasMapData: boolean;
  activityColor: string;
}

export function RouteDetailMap({
  routeGroup,
  highlightedActivityId,
  highlightedActivityPoints,
  signatures,
  hasMapData,
  activityColor,
}: RouteDetailMapProps) {
  return (
    <View testID="route-detail-map" style={styles.mapContainer}>
      {hasMapData ? (
        <RouteMapView
          routeGroup={routeGroup}
          height={MAP_HEIGHT}
          interactive={false}
          highlightedActivityId={highlightedActivityId}
          highlightedLapPoints={highlightedActivityPoints}
          enableFullscreen={true}
          activitySignatures={signatures}
        />
      ) : (
        <View
          style={[
            styles.mapPlaceholder,
            {
              height: MAP_HEIGHT,
              backgroundColor: activityColor + '20',
            },
          ]}
        >
          <MaterialCommunityIcons name="map-marker-path" size={48} color={activityColor} />
        </View>
      )}
    </View>
  );
}

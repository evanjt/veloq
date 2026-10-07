import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { RouteMapView } from './RouteMapView';
import { useHeroMapHeight } from '@/shared/ui';
import { styles } from './RouteDetailScreen.styles';
import type { buildFinalRouteGroup } from '../lib/buildRouteGroup';
import type { RoutePoint } from '../types';
import type { ActivityType } from '@/types';
import type { LatLngShort } from '@/shared/geo/distance';

type FinalRouteGroup = NonNullable<ReturnType<typeof buildFinalRouteGroup>>;

interface RouteDetailMapProps {
  routeGroup: FinalRouteGroup;
  highlightedActivityId: string | null;
  highlightedActivityPoints: RoutePoint[] | undefined;
  signatures: Record<string, { points: LatLngShort[] }>;
  hasMapData: boolean;
  activityColor: string;
  selectedSportType?: ActivityType | undefined;
}

export function RouteDetailMap({
  routeGroup,
  highlightedActivityId,
  highlightedActivityPoints,
  signatures,
  hasMapData,
  activityColor,
  selectedSportType,
}: RouteDetailMapProps) {
  const mapHeight = useHeroMapHeight();
  return (
    <View testID="route-detail-map" style={styles.mapContainer}>
      {hasMapData ? (
        <RouteMapView
          routeGroup={routeGroup}
          selectedSportType={selectedSportType}
          height={mapHeight}
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
              height: mapHeight,
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

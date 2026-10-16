import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { RouteMapView } from './RouteMapView';
import { useHeroMapHeight } from '@/shared/ui';
import { styles } from './RouteDetailScreen.styles';
import type { buildFinalRouteGroup } from '../lib/buildRouteGroup';
import { useMapHighlight, type MapHighlightStore } from '../lib/mapHighlight';
import type { ActivityType } from '@/types';
import type { LatLngShort } from '@/shared/geo/distance';
import type { SectionDeltaLine } from '../lib/deltaLayout';

import { iconSize } from '@/theme';
type FinalRouteGroup = NonNullable<ReturnType<typeof buildFinalRouteGroup>>;

interface RouteDetailMapProps {
  routeGroup: FinalRouteGroup;
  /** The chart's scrubbed attempt. Only this map reads it, so a scrub never renders the screen. */
  highlight: MapHighlightStore;
  signatures: Record<string, { points: LatLngShort[] }>;
  hasMapData: boolean;
  activityColor: string;
  selectedSportType?: ActivityType | undefined;
  /** The attempt the chart's delta plot shows, which colours the route line. */
  deltaLine?: SectionDeltaLine | null | undefined;
}

export function RouteDetailMap({
  routeGroup,
  highlight,
  signatures,
  hasMapData,
  activityColor,
  selectedSportType,
  deltaLine,
}: RouteDetailMapProps) {
  const mapHeight = useHeroMapHeight();
  const { activityId, lapPoints } = useMapHighlight(highlight);
  return (
    <View testID="route-detail-map" style={styles.mapContainer}>
      {hasMapData ? (
        <RouteMapView
          routeGroup={routeGroup}
          selectedSportType={selectedSportType}
          height={mapHeight}
          interactive={false}
          highlightedActivityId={activityId}
          highlightedLapPoints={lapPoints}
          enableFullscreen={true}
          activitySignatures={signatures}
          deltaLine={deltaLine}
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
          <MaterialCommunityIcons
            name="map-marker-path"
            size={iconSize.xxl}
            color={activityColor}
          />
        </View>
      )}
    </View>
  );
}

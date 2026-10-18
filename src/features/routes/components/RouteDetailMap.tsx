/**
 * A route's map filling its host's map screen, under the sheet that holds the route's card. It
 * reads the route from the engine as the card does, and what the card picked (the attempt, the
 * sport on show, the line the delta plot colours) from the host's entry. The route is fitted to
 * the part of the map the header and the sheet's settled stop leave visible, or beside the side
 * panel at regular width.
 */
import React, { useMemo } from 'react';
import { I18nManager, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ROUTE_MAP_FIT_PADDING, RouteMapView } from './RouteMapView';
import { Icon } from '@/shared/ui/Icon';
import { useHeroHeaderBottom } from '@/shared/ui/useHeroHeaderBottom';
import { mapSheetHostKey } from '@/shared/app/mapSheetHost';
import {
  mapSheetCoveredHeight,
  mapSheetCoveredSides,
  useMapSheetStop,
} from '@/shared/app/mapSheetStop';
import { visibleMapInset } from '@/features/maps';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { useRouteDetailData } from '../hooks/useRouteDetailData';
import { useRouteMapSignatures } from '../hooks';
import {
  buildFinalRouteGroup,
  buildRouteGroupBase,
  representativePointsOf,
} from '../lib/buildRouteGroup';
import { routeHeadline } from '../lib/routeHeadline';
import { useCardAttempt, useCardDeltaLine, useCardSport } from '../lib/detailCardState';
import { toActivityType } from '../types';

import { colorWithOpacity, iconSize, opacity } from '@/theme';

interface RouteDetailMapProps {
  /** The route's group id. */
  routeId: string;
  /** The activity the page was opened from, the only one the map key calls "This activity". */
  pageActivityId?: string | undefined;
}

export function RouteDetailMap({ routeId, pageActivityId }: RouteDetailMapProps) {
  const hostKey = mapSheetHostKey('route', routeId);
  const { data: detail } = useRouteDetailData(routeId);
  const { activityId, lapPoints, date } = useCardAttempt(hostKey);
  const sport = useCardSport(hostKey);
  const deltaLine = useCardDeltaLine(hostKey);
  const { stop } = useMapSheetStop(hostKey);

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerBottom = useHeroHeaderBottom();
  const fitPadding = useMemo(() => {
    const sides = mapSheetCoveredSides({ width }, I18nManager.isRTL);
    return visibleMapInset({
      width,
      height,
      coveredTop: headerBottom,
      coveredLeft: sides.left,
      coveredRight: sides.right,
      coveredBottom: mapSheetCoveredHeight(
        Platform.OS,
        Platform.Version,
        { width, height, topInset: insets.top, bottomInset: insets.bottom },
        stop
      ),
      margin: ROUTE_MAP_FIT_PADDING,
    });
  }, [width, height, headerBottom, insets.top, insets.bottom, stop]);

  const engineGroup = detail?.group;
  const routeGroup = useMemo(
    () =>
      buildFinalRouteGroup(
        buildRouteGroupBase(engineGroup),
        representativePointsOf(detail),
        routeHeadline(detail).distance
      ),
    [engineGroup, detail]
  );
  const signatures = useRouteMapSignatures(engineGroup, detail?.mapSignatures);

  // The sport on screen colours the map placeholder and chooses the map's style.
  const displayType = toActivityType(sport);
  const activityColor = getActivityColor(displayType);

  return (
    <View testID="route-detail-map" style={styles.fill}>
      {routeGroup && engineGroup?.activityIds.length ? (
        <RouteMapView
          routeGroup={routeGroup}
          selectedSportType={sport ? displayType : undefined}
          height={height}
          interactive
          highlightedActivityId={activityId}
          highlightedLapPoints={lapPoints}
          highlightedActivityDate={date}
          pageActivityId={pageActivityId}
          activitySignatures={signatures}
          deltaLine={deltaLine}
          fitPadding={fitPadding}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { backgroundColor: colorWithOpacity(activityColor, opacity.tint2) },
          ]}
        >
          <Icon name="map-marker-path" size={iconSize.xxl} color={activityColor} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

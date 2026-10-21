/**
 * A route's map filling its host's map screen, under the sheet that holds the route's card. It
 * reads the route from the engine as the card does, and what the card picked (the attempt, the
 * sport on show, the line the delta plot colours) from the host's entry. Inside the host's slot it
 * draws on the host's one surface, which the other cards' maps share. The route is fitted to
 * the part of the map the header and the sheet's settled stop leave visible, or beside the side
 * panel at regular width.
 */
import React, { useMemo } from 'react';
import { I18nManager, Platform, StyleSheet, View } from 'react-native';

import { ROUTE_MAP_FIT_PADDING, RouteMapView } from './RouteMapView';
import { Icon } from '@/shared/ui/Icon';
import { useHeroHeaderBottom } from '@/shared/ui/useHeroHeaderBottom';
import { mapSheetHostKey } from '@/shared/app/mapSheetHost';
import {
  mapSheetCoveredCorner,
  mapSheetCoveredHeight,
  mapSheetCoveredSides,
  useMapSheetStop,
} from '@/shared/app/mapSheetStop';
import { useInMapSurfaceSlot, visibleMapInset } from '@/features/maps';
import { useMapSheetHost } from '@/shared/app/MapSheetHost';
import { useSheetWindow } from '@/shared/app/TopSafeAreaContext';
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
  // A route card pushed onto another subject's host reads that host's entry.
  const hostKey = useMapSheetHost()?.key ?? mapSheetHostKey('route', routeId);
  const inSlot = useInMapSurfaceSlot();
  const { data: detail } = useRouteDetailData(routeId);
  const { activityId, lapPoints, date } = useCardAttempt(hostKey);
  const sport = useCardSport(hostKey);
  const deltaLine = useCardDeltaLine(hostKey);
  const { stop } = useMapSheetStop(hostKey);

  const sheetWindow = useSheetWindow();
  const { width, height } = sheetWindow;
  const headerBottom = useHeroHeaderBottom();
  const coveredBottom = mapSheetCoveredHeight(Platform.OS, Platform.Version, sheetWindow, stop);
  const fitPadding = useMemo(() => {
    const sides = mapSheetCoveredSides({ width, height }, I18nManager.isRTL);
    return visibleMapInset({
      width,
      height,
      coveredTop: headerBottom,
      coveredLeft: sides.left,
      coveredRight: sides.right,
      coveredBottom,
      margin: ROUTE_MAP_FIT_PADDING,
    });
  }, [width, height, headerBottom, coveredBottom]);

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
    <View
      testID="route-detail-map"
      style={styles.fill}
      pointerEvents={inSlot ? 'box-none' : 'auto'}
    >
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
          coveredBottom={coveredBottom}
          coveredBottomRadius={mapSheetCoveredCorner(coveredBottom)}
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

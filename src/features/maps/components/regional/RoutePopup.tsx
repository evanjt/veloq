import React, { memo, useRef } from 'react';
import type { TextInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMetricSystem } from '@/shared/app';
import { formatDistance } from '@/shared/format/format';
import { useFocusOnAppear } from '@/shared/ui/useFocusOnAppear';
import { MapPopup } from './MapPopup';
import { ACTIVITY_COUNT_GLYPH } from '@/features/maps/lib/mapGlyphs';

/** What the popup shows for a route, as the map read gives it. */
export interface MapRouteSummary {
  routeId: string;
  name: string;
  activityCount: number;
  /** The representative's distance, as the route list shows it */
  distanceMeters: number;
}

interface RoutePopupProps {
  route: MapRouteSummary;
  bottom: number;
  /** Tallest the card may grow before its body scrolls */
  maxHeight?: number | undefined;
  onClose: () => void;
  onViewDetails: () => void;
}

export const RoutePopup = memo(function RoutePopup({
  route,
  bottom,
  maxHeight,
  onClose,
  onViewDetails,
}: RoutePopupProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const titleRef = useRef<TextInstance>(null);
  useFocusOnAppear(titleRef, route.routeId);

  // The engine names every route it draws; the id stands in only for a read
  // that found no name.
  const displayName = route.name || route.routeId;

  return (
    <MapPopup
      testID="route-popup"
      titleTestID="route-popup-title"
      closeTestID="route-popup-close"
      style={{ bottom, maxHeight }}
      titleRef={titleRef}
      title={displayName}
      stats={[
        {
          key: 'distance',
          icon: 'map-marker-distance',
          value: formatDistance(route.distanceMeters, isMetric),
        },
        {
          key: 'activities',
          icon: ACTIVITY_COUNT_GLYPH,
          value: t('routes.activitiesCount', { count: route.activityCount }),
        },
      ]}
      viewDetails={{ testID: 'route-popup-view-details', onPress: onViewDetails }}
      closeLabel={t('maps.closeRoutePopup')}
      onClose={onClose}
    />
  );
});

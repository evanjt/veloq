/**
 * Row showing a route (during processing or from saved groups).
 * Displays the route with activity count and preview polyline.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo } from '@/shared/app/navigation';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import { Card } from '@/shared/ui/Card';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { SportIcons } from '@/shared/activity/SportIcons';
import { formatDistance } from '@/shared/format/format';
import { useRepresentativeRoute } from '@/features/routes/hooks/useEngine';
import { toActivityType } from '@/features/routes/types';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { TrackPreview, normalizeTrackPoints } from '@/shared/ui/TrackPreview';
import {
  ROW_MARGIN_BOTTOM,
  ROW_MARGIN_HORIZONTAL,
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
} from '@/features/routes/lib/rowLayout';

interface RouteRowProps {
  /** Route data - can be either DiscoveredRouteInfo (during processing) or RouteGroup (saved) */
  route: DiscoveredRouteInfo | RouteGroup;
  /** If true, tapping navigates to route detail. If false/undefined, just expands. */
  navigable?: boolean | undefined;
  /** Distance from user's current location in meters */
  distanceFromUser?: number | undefined;
}

/** Check if route is a RouteGroup (has signature property) */
function isRouteGroup(route: DiscoveredRouteInfo | RouteGroup): route is RouteGroup {
  return 'signature' in route;
}

function RouteRowComponent({ route, navigable = false, distanceFromUser }: RouteRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  // Use pre-loaded representative points if available, otherwise lazy-load.
  const preloadedRepresentative =
    isRouteGroup(route) && route.representativePoints?.length ? route.representativePoints : null;
  const { points: lazyRepresentativePoints } = useRepresentativeRoute(
    isRouteGroup(route) && !preloadedRepresentative ? route.id : null
  );
  const representativePoints = preloadedRepresentative ?? lazyRepresentativePoints;

  // Display name comes from parent via route.name (which includes custom name from useRouteGroups)
  // This ensures reactivity when names change via the hook chain
  const displayName = route.name;

  // Get activity color for the route type
  // RouteGroup.type is ActivityType, DiscoveredRouteInfo.type is string
  const activityColor = colors.primary;

  // Get preview points from the route's representative.
  const previewPoints = useMemo(() => {
    if (isRouteGroup(route)) {
      return representativePoints ? normalizeTrackPoints(representativePoints) : [];
    } else {
      // DiscoveredRouteInfo - use previewPoints directly
      return route.previewPoints || [];
    }
  }, [route, representativePoints]);

  // Get distance from either type
  const distance = isRouteGroup(route) ? route.distance : route.distance;

  // Get match percentage (only available on DiscoveredRouteInfo)
  const avgMatchPercentage = isRouteGroup(route)
    ? route.averageMatchQuality
    : route.avgMatchPercentage;

  // The expandable form is gone: its activity list was fed by `activityIds`,
  // which `batchGroupToRouteGroup` always builds empty, so it never had a row
  // to draw. Every row the list renders is navigable.
  const handlePress = () => {
    if (navigable) navigateTo(`/route/${route.id}`);
  };

  return (
    <View style={styles.wrapper} testID={`route-row-${route.id}`}>
      <Card
        variant="flat"
        padding="sm"
        style={{ flexDirection: 'row', alignItems: 'center' }}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={displayName}
        testID={`route-row-${route.id}-touch`}
      >
        {/* Route preview with map-like backdrop */}
        <View style={styles.previewBox}>
          {previewPoints.length > 1 ? (
            <TrackPreview points={previewPoints} color={activityColor} isDark={isDark} />
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              <MaterialCommunityIcons
                name={getActivityIcon(toActivityType(route.type))}
                size={18}
                color={isDark ? darkColors.iconFaint : colors.iconFaint}
              />
            </View>
          )}
        </View>

        {/* Route info */}
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
              {displayName}
            </Text>
            {/* Show sport type icons for all activity types in this route */}
            {isRouteGroup(route) && route.sportTypes && route.sportTypes.length > 0 && (
              <View style={styles.sportTypeIcons}>
                <SportIcons
                  sportTypes={route.sportTypes}
                  size={12}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            {distance && distance > 0 && (
              <Text style={[styles.metaText, isDark && styles.textMuted]}>
                {formatDistance(distance, isMetric)}
              </Text>
            )}
            {distanceFromUser != null && Number.isFinite(distanceFromUser) && (
              <View style={styles.proximityTag}>
                <MaterialCommunityIcons
                  name="map-marker-distance"
                  size={10}
                  color={isDark ? darkColors.textDisabled : colors.textDisabled}
                />
                <Text style={[styles.proximityText, isDark && styles.proximityTextDark]}>
                  {formatDistance(distanceFromUser, isMetric)}
                </Text>
              </View>
            )}
            {avgMatchPercentage !== undefined && avgMatchPercentage > 0 && (
              <Text
                style={[
                  styles.matchPercent,
                  { color: isDark ? darkColors.successDeep : colors.successDeep },
                ]}
              >
                {Math.round(avgMatchPercentage)}% {t('routes.match')}
              </Text>
            )}
          </View>
        </View>

        {/* Activity count badge */}
        <View
          style={styles.countBadge}
          accessible
          accessibilityLabel={t('routes.activitiesCount', { count: route.activityCount })}
          testID={`route-row-${route.id}-count`}
        >
          <MaterialCommunityIcons
            name="map-marker-multiple"
            size={typography.bodyCompact.fontSize}
            color={colors.textOnPrimary}
            testID={`route-row-${route.id}-count-glyph`}
          />
          <Text style={styles.countText}>{route.activityCount}</Text>
          <MaterialCommunityIcons
            name={navigable ? 'chevron-right' : 'chevron-down'}
            size={16}
            color={
              navigable ? colors.textOnDark : isDark ? colors.neutralLine : colors.textSecondary
            }
          />
        </View>
      </Card>
    </View>
  );
}

// Memoize - only re-render if route data changes
export const RouteRow = memo(RouteRowComponent, (prevProps, nextProps) =>
  rowIsUnchanged(
    {
      record: prevProps.route,
      extras: [prevProps.navigable, prevProps.distanceFromUser],
    },
    {
      record: nextProps.route,
      extras: [nextProps.navigable, nextProps.distanceFromUser],
    }
  )
);

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: ROW_MARGIN_HORIZONTAL,
    marginBottom: ROW_MARGIN_BOTTOM,
  },
  previewBox: {
    width: ROW_PREVIEW_WIDTH,
    height: ROW_PREVIEW_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  previewPlaceholder: {
    width: ROW_PREVIEW_WIDTH,
    height: ROW_PREVIEW_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    backgroundColor: opacity.overlay.subtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewPlaceholderDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeName: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  sportTypeIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xxs,
    gap: spacing.sm,
  },
  metaText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  proximityTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xxs,
  },
  proximityText: {
    fontSize: typography.micro.fontSize,
    color: colors.textDisabled,
  },
  proximityTextDark: {
    color: darkColors.textDisabled,
  },
  matchPercent: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    gap: spacing.xxs,
  },
  countText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});

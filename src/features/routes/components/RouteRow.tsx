/**
 * Row showing a route (during processing or from saved groups).
 * Displays the route with activity count and preview polyline.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { navigateTo } from '@/shared/app/navigation';
import { useTranslation } from 'react-i18next';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { Card } from '@/shared/ui/Card';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { SportIcons } from '@/shared/activity/SportIcons';
import { formatDistance } from '@/shared/format/format';
import { toActivityType } from '@/features/routes/types';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import {
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
  rowContainers,
} from '@/features/routes/lib/rowLayout';
import { NameText } from '@/shared/ui/NameText';
import { Icon } from '@/shared/ui/Icon';
import { Badge } from '@/shared/ui/Badge';

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
  const palette = themePalette(isDark);
  const isMetric = useMetricSystem();

  // The routes screen read carries the row's line, already strided to the
  // thumbnail, falling back to the representative's stored track when it has
  // no signature. An empty line means the engine has none to draw.
  const representativePoints = isRouteGroup(route) ? route.representativePoints : null;

  // Display name comes from parent via route.name (which includes custom name from useRouteGroups)
  // This ensures reactivity when names change via the hook chain
  const displayName = route.name;

  // Get preview points from the route's representative.
  const previewPoints = useMemo(() => {
    if (isRouteGroup(route)) {
      return representativePoints ? normaliseTrackPoints(representativePoints) : [];
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

  const distanceText = distance && distance > 0 ? formatDistance(distance, isMetric) : null;
  const proximityText =
    distanceFromUser != null && Number.isFinite(distanceFromUser)
      ? formatDistance(distanceFromUser, isMetric)
      : null;
  const matchText =
    avgMatchPercentage !== undefined && avgMatchPercentage > 0
      ? `${Math.round(avgMatchPercentage)}% ${t('routes.match')}`
      : null;
  const countLabel = t('routes.activitiesCount', { count: route.activityCount });

  // The expandable form is gone: its activity list was fed by `activityIds`,
  // which `batchGroupToRouteGroup` always builds empty, so it never had a row
  // to draw. Every row the list renders is navigable.
  const handlePress = () => {
    if (navigable) navigateTo(`/route/${route.id}`);
  };

  return (
    <View style={rowContainers.wrapper} testID={`route-row-${route.id}`}>
      <Card
        variant="flat"
        padding="sm"
        style={rowContainers.card}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={composeAccessibilityLabel(
          displayName,
          distanceText,
          proximityText,
          matchText,
          countLabel
        )}
        testID={`route-row-${route.id}-touch`}
      >
        <View style={rowContainers.previewBox}>
          {previewPoints.length > 1 ? (
            <TrackPreview points={previewPoints} isDark={isDark} />
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              <Icon
                name={getActivityIcon(toActivityType(route.type))}
                size={iconSize.md}
                color={isDark ? darkColors.iconMuted : colors.iconMuted}
              />
            </View>
          )}
        </View>

        {/* Route info */}
        <View style={rowContainers.infoContainer}>
          <View style={rowContainers.nameRow}>
            <NameText style={[rowContainers.name, styles.routeName, isDark && styles.textLight]}>
              {displayName}
            </NameText>
            {/* Show sport type icons for all activity types in this route */}
            {isRouteGroup(route) && route.sportTypes && route.sportTypes.length > 0 ? (
              <View style={styles.sportTypeIcons}>
                <SportIcons
                  sportTypes={route.sportTypes}
                  size={iconSize.xs}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </View>
            ) : null}
          </View>
          <View style={rowContainers.metaRow}>
            {distanceText ? (
              <Text
                style={[rowContainers.metaText, styles.metaText, isDark && styles.textSecondary]}
              >
                {distanceText}
              </Text>
            ) : null}
            {proximityText ? (
              <View style={styles.proximityTag}>
                <Icon
                  name="map-marker-distance"
                  size={iconSize.xs}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.proximityText, isDark && styles.proximityTextDark]}>
                  {proximityText}
                </Text>
              </View>
            ) : null}
            {matchText ? (
              <Text
                style={[
                  styles.matchPercent,
                  { color: isDark ? darkColors.successText : colors.successText },
                ]}
              >
                {matchText}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.countCell}>
          <Badge
            tone="count"
            icon="map-marker-multiple"
            text={route.activityCount}
            label={countLabel}
            isDark={isDark}
            testID={`route-row-${route.id}-count`}
          />
          <Icon
            name={navigable ? 'chevron-right' : 'chevron-down'}
            size={iconSize.sm}
            color={palette.iconSecondary}
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
  routeName: {
    color: colors.textPrimary,
  },
  sportTypeIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  metaText: {
    color: colors.textSecondary,
  },
  proximityTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xxs,
  },
  proximityText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  proximityTextDark: {
    color: darkColors.textSecondary,
  },
  matchPercent: {
    ...typography.badge,
  },
  countCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  textLight: {
    color: colors.textOnFill,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});

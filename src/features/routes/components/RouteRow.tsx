/**
 * Row showing a route (during processing or from saved groups).
 * Displays the route with activity count and preview polyline.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo } from '@/shared/app/navigation';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing, layout, typography, shadows } from '@/theme';
import { getActivityColor, getActivityIcon, isPaceSport } from '@/shared/activity/activityUtils';
import { formatPace, formatSpeed, formatDistance } from '@/shared/format/format';
import { useConsensusRoute } from '@/features/routes/hooks/useEngine';
import { toActivityType } from '@/features/routes/types';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { TrackPreview, normalizeTrackPoints } from '@/shared/ui/TrackPreview';

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

  // Use pre-loaded consensus points if available (from batch FFI), otherwise lazy-load
  const preloadedConsensus =
    isRouteGroup(route) && route.consensusPoints?.length ? route.consensusPoints : null;
  const { points: lazyConsensusPoints } = useConsensusRoute(
    isRouteGroup(route) && !preloadedConsensus ? route.id : null
  );
  const consensusPoints = preloadedConsensus ?? lazyConsensusPoints;

  // Display name comes from parent via route.name (which includes custom name from useRouteGroups)
  // This ensures reactivity when names change via the hook chain
  const displayName =
    route.name || (t('routes.defaultRouteName' as never, { type: route.type }) as string);

  // Get activity color for the route type
  // RouteGroup.type is ActivityType, DiscoveredRouteInfo.type is string
  const activityColor = colors.primary;

  // Get preview points - use lazy-loaded consensus for RouteGroup
  const previewPoints = useMemo(() => {
    if (isRouteGroup(route)) {
      // RouteGroup - use lazy-loaded consensus points
      return consensusPoints ? normalizeTrackPoints(consensusPoints) : [];
    } else {
      // DiscoveredRouteInfo - use previewPoints directly
      return route.previewPoints || [];
    }
  }, [route, consensusPoints]);

  const getTypeIcon = (): 'bike' | 'run' | 'swim' | 'walk' | 'map-marker' => {
    const routeType = route.type?.toLowerCase() || '';
    if (routeType.includes('ride') || routeType.includes('cycling')) return 'bike';
    if (routeType.includes('run')) return 'run';
    if (routeType.includes('swim')) return 'swim';
    if (routeType.includes('walk') || routeType.includes('hike')) return 'walk';
    return 'map-marker';
  };

  // Get distance from either type
  const distance = isRouteGroup(route) ? route.distance : route.distance;

  // Get match percentage (only available on DiscoveredRouteInfo)
  const avgMatchPercentage = isRouteGroup(route)
    ? route.averageMatchQuality
    : route.avgMatchPercentage;

  // Get best pace (only available on RouteGroup with performance data)
  const bestPace = isRouteGroup(route) ? route.bestPace : undefined;
  const routeType = toActivityType(route.type);
  const showPace = isPaceSport(routeType);

  // Format pace/speed for display
  const formattedPace = useMemo(() => {
    if (!bestPace || bestPace <= 0) return null;
    return showPace ? formatPace(bestPace, isMetric) : formatSpeed(bestPace, isMetric);
  }, [bestPace, showPace, isMetric]);

  // The expandable form is gone: its activity list was fed by `activityIds`,
  // which `batchGroupToRouteGroup` always builds empty, so it never had a row
  // to draw. Every row the list renders is navigable.
  const handlePress = () => {
    if (navigable) navigateTo(`/route/${route.id}`);
  };

  return (
    <View style={styles.wrapper} testID={`route-row-${route.id}`}>
      <TouchableOpacity
        style={[styles.container, isDark && styles.containerDark]}
        onPress={handlePress}
        activeOpacity={0.7}
        testID={`route-row-${route.id}-touch`}
      >
        {/* Route preview with map-like backdrop */}
        <View style={styles.previewBox}>
          {previewPoints.length > 1 ? (
            <TrackPreview points={previewPoints} color={activityColor} isDark={isDark} />
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              <MaterialCommunityIcons
                name={getTypeIcon()}
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
                {route.sportTypes.map((st) => (
                  <MaterialCommunityIcons
                    key={st}
                    name={getActivityIcon(toActivityType(st))}
                    size={14}
                    color={getActivityColor(toActivityType(st))}
                  />
                ))}
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
            {formattedPace && (
              <Text style={[styles.paceText, { color: colors.primary }]}>{formattedPace}</Text>
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
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{route.activityCount}</Text>
          <MaterialCommunityIcons
            name={navigable ? 'chevron-right' : 'chevron-down'}
            size={16}
            color={
              navigable ? colors.textOnDark : isDark ? colors.neutralLine : colors.textSecondary
            }
          />
        </View>
      </TouchableOpacity>
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
    marginHorizontal: spacing.md,
    marginBottom: spacing.xxs,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.xsPlus,
    ...shadows.pill,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  previewBox: {
    width: 48,
    height: 36,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  previewPlaceholder: {
    width: 48,
    height: 36,
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
    gap: spacing.xs,
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
    gap: spacing.xxs,
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
  paceText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
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
  expandedList: {
    backgroundColor: opacity.overlay.subtle,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: -spacing.xxs,
  },
  expandedListDark: {
    backgroundColor: opacity.overlayDark.subtle,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  activityName: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  moreText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
});

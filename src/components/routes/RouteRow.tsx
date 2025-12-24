/**
 * Row showing a route (during processing or from saved groups).
 * Displays the route with activity count and preview polyline.
 */

import React, { memo, useState, useMemo } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline, Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import { router, Href } from 'expo-router';
import { colors, spacing } from '@/theme';
import { getActivityColor } from '@/lib';
import type { DiscoveredRouteInfo, RouteGroup } from '@/types';

interface RouteRowProps {
  /** Route data - can be either DiscoveredRouteInfo (during processing) or RouteGroup (saved) */
  route: DiscoveredRouteInfo | RouteGroup;
  /** If true, tapping navigates to route detail. If false/undefined, just expands. */
  navigable?: boolean;
}

/** Check if route is a RouteGroup (has signature property) */
function isRouteGroup(route: DiscoveredRouteInfo | RouteGroup): route is RouteGroup {
  return 'signature' in route;
}

/** Convert signature GPS points to normalized preview points (0-1) */
function normalizePoints(points: { lat: number; lng: number }[]): { x: number; y: number }[] {
  if (points.length < 2) return [];

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  return points.map(p => ({
    x: (p.lng - minLng) / lngRange,
    y: 1 - (p.lat - minLat) / latRange, // Invert Y for screen coordinates
  }));
}

interface RoutePreviewProps {
  points: { x: number; y: number }[];
  color: string;
  isDark: boolean;
}

const RoutePreview = memo(function RoutePreview({ points, color, isDark }: RoutePreviewProps) {
  if (points.length < 2) return null;

  const width = 56;
  const height = 40;
  const padding = 4;

  const scaledPoints = points.map(p => ({
    x: p.x * (width - padding * 2) + padding,
    y: p.y * (height - padding * 2) + padding,
  }));

  const pointsString = scaledPoints.map(p => `${p.x},${p.y}`).join(' ');
  const startPoint = scaledPoints[0];
  const endPoint = scaledPoints[scaledPoints.length - 1];

  // Background colors for map-like appearance
  const bgColor = isDark ? '#1a2a1a' : '#e8f4e8';
  const gridColor = isDark ? '#2a3a2a' : '#d0e8d0';

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="mapGradient" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
          <Stop offset="1" stopColor={isDark ? '#0d1a0d' : '#d4e8d4'} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* Map-like background */}
      <Rect x="0" y="0" width={width} height={height} fill="url(#mapGradient)" rx="4" />

      {/* Subtle grid lines for map effect */}
      <Polyline
        points={`${width/3},0 ${width/3},${height}`}
        stroke={gridColor}
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      <Polyline
        points={`${2*width/3},0 ${2*width/3},${height}`}
        stroke={gridColor}
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      <Polyline
        points={`0,${height/2} ${width},${height/2}`}
        stroke={gridColor}
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />

      {/* Route shadow for depth */}
      <Polyline
        points={pointsString}
        fill="none"
        stroke="#000000"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.15}
        transform="translate(0.5, 0.5)"
      />

      {/* Route line */}
      <Polyline
        points={pointsString}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Start marker (green) */}
      <Circle cx={startPoint.x} cy={startPoint.y} r={3} fill={colors.success} />
      <Circle cx={startPoint.x} cy={startPoint.y} r={2} fill="#FFFFFF" />

      {/* End marker (red) */}
      <Circle cx={endPoint.x} cy={endPoint.y} r={3} fill={colors.error} />
      <Circle cx={endPoint.x} cy={endPoint.y} r={2} fill="#FFFFFF" />
    </Svg>
  );
});

function RouteRowComponent({ route, navigable = false }: RouteRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [expanded, setExpanded] = useState(false);

  // Get activity color for the route type
  const activityColor = getActivityColor(route.type as any);

  // Get preview points - use the representative signature (full route)
  // NOT consensus points, which can be truncated to just the common core
  const previewPoints = useMemo(() => {
    if (isRouteGroup(route)) {
      // RouteGroup - always use the representative signature (the full route)
      return route.signature?.points ? normalizePoints(route.signature.points) : [];
    } else {
      // DiscoveredRouteInfo - use previewPoints directly
      return route.previewPoints || [];
    }
  }, [route]);

  // Get activity names for expansion
  const activityNames = useMemo(() => {
    if (isRouteGroup(route)) {
      // RouteGroup doesn't have activity names, just IDs
      return route.activityIds.map((_, i) => `Activity ${i + 1}`);
    }
    return route.activityNames || [];
  }, [route]);

  const getTypeIcon = (): 'bike' | 'run' | 'swim' | 'walk' | 'map-marker' => {
    const t = route.type?.toLowerCase() || '';
    if (t.includes('ride') || t.includes('cycling')) return 'bike';
    if (t.includes('run')) return 'run';
    if (t.includes('swim')) return 'swim';
    if (t.includes('walk') || t.includes('hike')) return 'walk';
    return 'map-marker';
  };

  const formatDistance = (meters?: number) => {
    if (!meters) return '';
    return `${(meters / 1000).toFixed(1)}km`;
  };

  // Get distance from either type
  const distance = isRouteGroup(route) ? route.signature?.distance : route.distance;

  // Get match percentage (only available on DiscoveredRouteInfo)
  const avgMatchPercentage = isRouteGroup(route) ? route.averageMatchQuality : route.avgMatchPercentage;

  const handlePress = () => {
    if (navigable) {
      router.push(`/route/${route.id}` as Href);
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[styles.container, isDark && styles.containerDark]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        {/* Route preview with map-like backdrop */}
        <View style={styles.previewBox}>
          {previewPoints.length > 1 ? (
            <RoutePreview points={previewPoints} color={activityColor} isDark={isDark} />
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              <MaterialCommunityIcons
                name={getTypeIcon()}
                size={18}
                color={isDark ? '#555' : '#BBB'}
              />
            </View>
          )}
        </View>

        {/* Route info */}
        <View style={styles.infoContainer}>
          <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
            {route.name}
          </Text>
          <View style={styles.metaRow}>
            {distance && distance > 0 && (
              <Text style={[styles.metaText, isDark && styles.textMuted]}>
                {formatDistance(distance)}
              </Text>
            )}
            {avgMatchPercentage !== undefined && avgMatchPercentage > 0 && (
              <Text style={[styles.matchPercent, { color: colors.success }]}>
                {Math.round(avgMatchPercentage)}% match
              </Text>
            )}
          </View>
        </View>

        {/* Activity count badge */}
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{route.activityCount}</Text>
          <MaterialCommunityIcons
            name={navigable ? 'chevron-right' : (expanded ? 'chevron-up' : 'chevron-down')}
            size={16}
            color={navigable ? '#FFFFFF' : (isDark ? '#888' : colors.textSecondary)}
          />
        </View>
      </TouchableOpacity>

      {/* Expanded activity list - only show when not navigable */}
      {expanded && !navigable && (
        <View style={[styles.expandedList, isDark && styles.expandedListDark]}>
          {activityNames.slice(0, 5).map((name, idx) => (
            <View key={route.activityIds[idx] || idx} style={styles.activityItem}>
              <MaterialCommunityIcons
                name="checkbox-marked-circle-outline"
                size={14}
                color={colors.success}
              />
              <Text style={[styles.activityName, isDark && styles.textMuted]} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
          {route.activityCount > 5 && (
            <Text style={[styles.moreText, isDark && styles.textMuted]}>
              +{route.activityCount - 5} more
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// Memoize - only re-render if route data changes
export const RouteRow = memo(RouteRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.route.id === nextProps.route.id &&
    prevProps.route.activityCount === nextProps.route.activityCount &&
    prevProps.navigable === nextProps.navigable
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  containerDark: {
    backgroundColor: '#1A1A1A',
  },
  previewBox: {
    width: 56,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
  },
  previewPlaceholder: {
    width: 56,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewPlaceholderDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  routeName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sm,
  },
  metaText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  matchPercent: {
    fontSize: 11,
    fontWeight: '500',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 2,
  },
  countText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#777',
  },
  expandedList: {
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: -2,
  },
  expandedListDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  activityName: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  moreText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

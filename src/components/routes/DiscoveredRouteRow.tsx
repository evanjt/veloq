/**
 * Row showing a discovered route match during processing.
 * Starts simple and adds detail as more info becomes available.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, useColorScheme, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';

export interface DiscoveredRoute {
  id: string;
  name: string;
  type: string;
  activityCount: number;
  activityNames: string[];
  /** Simplified route points for preview (if available) */
  previewPoints?: { x: number; y: number }[];
  /** Whether this route is still being matched */
  isActive?: boolean;
  /** Distance in meters */
  distance?: number;
}

interface DiscoveredRouteRowProps {
  route: DiscoveredRoute;
  index: number;
}

function RoutePreview({ points }: { points: { x: number; y: number }[] }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (points.length < 2) return null;

  // Normalize points to fit in the preview area
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  const width = 60;
  const height = 40;
  const padding = 4;

  const scaleX = (maxX - minX) > 0 ? (width - padding * 2) / (maxX - minX) : 1;
  const scaleY = (maxY - minY) > 0 ? (height - padding * 2) / (maxY - minY) : 1;
  const scale = Math.min(scaleX, scaleY);

  const normalizedPoints = points.map(p => ({
    x: (p.x - minX) * scale + padding,
    y: (p.y - minY) * scale + padding,
  }));

  const pointsString = normalizedPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <View style={[styles.previewContainer, isDark && styles.previewContainerDark]}>
      <Svg width={width} height={height}>
        <Polyline
          points={pointsString}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function PlaceholderPreview({ type }: { type: string }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const getIcon = () => {
    const t = type?.toLowerCase() || '';
    if (t.includes('ride') || t.includes('cycling')) return 'bike';
    if (t.includes('run')) return 'run';
    if (t.includes('swim')) return 'swim';
    if (t.includes('walk') || t.includes('hike')) return 'walk';
    return 'map-marker-path';
  };

  return (
    <View style={[styles.previewContainer, styles.placeholderPreview, isDark && styles.previewContainerDark]}>
      <MaterialCommunityIcons
        name={getIcon()}
        size={20}
        color={isDark ? '#444' : '#CCC'}
      />
    </View>
  );
}

export function DiscoveredRouteRow({ route, index }: DiscoveredRouteRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entry animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        delay: index * 100,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim, index]);

  // Pulse animation when active
  useEffect(() => {
    if (route.isActive) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.02,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [route.isActive, pulseAnim]);

  const formatDistance = (meters?: number) => {
    if (!meters) return null;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  return (
    <Animated.View
      style={[
        styles.container,
        isDark && styles.containerDark,
        route.isActive && styles.containerActive,
        {
          opacity: fadeAnim,
          transform: [
            { scale: Animated.multiply(scaleAnim, pulseAnim) },
          ],
        },
      ]}
    >
      {/* Route preview or placeholder */}
      {route.previewPoints && route.previewPoints.length > 1 ? (
        <RoutePreview points={route.previewPoints} />
      ) : (
        <PlaceholderPreview type={route.type} />
      )}

      {/* Route info */}
      <View style={styles.infoContainer}>
        <View style={styles.headerRow}>
          <Text
            style={[styles.routeName, isDark && styles.textLight]}
            numberOfLines={1}
          >
            {route.name || 'New Route'}
          </Text>
          {route.isActive && (
            <View style={styles.activeBadge}>
              <MaterialCommunityIcons name="loading" size={12} color={colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.detailsRow}>
          <View style={styles.countBadge}>
            <MaterialCommunityIcons
              name="checkbox-multiple-marked-outline"
              size={12}
              color={colors.primary}
            />
            <Text style={styles.countText}>{route.activityCount}</Text>
          </View>

          {route.distance && (
            <Text style={[styles.distanceText, isDark && styles.textMuted]}>
              {formatDistance(route.distance)}
            </Text>
          )}
        </View>

        {/* Activity names preview */}
        {route.activityNames.length > 0 && (
          <Text
            style={[styles.activitiesText, isDark && styles.textMuted]}
            numberOfLines={1}
          >
            {route.activityNames.slice(0, 3).join(', ')}
            {route.activityNames.length > 3 && ` +${route.activityNames.length - 3} more`}
          </Text>
        )}
      </View>

      {/* Match indicator */}
      <View style={styles.matchIndicator}>
        <MaterialCommunityIcons
          name="check-circle"
          size={20}
          color={colors.success}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  containerActive: {
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  previewContainer: {
    width: 60,
    height: 40,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.subtle,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContainerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  placeholderPreview: {
    backgroundColor: opacity.overlay.subtle,
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  activeBadge: {
    marginLeft: spacing.xs,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sm,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  countText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
  distanceText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  activitiesText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  matchIndicator: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

/**
 * Section row component.
 * Displays a frequently-traveled road section with polyline preview and stats.
 * Now shows activity traces overlaid on section for richer visualization.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline, G } from 'react-native-svg';
import { colors, spacing, layout } from '@/theme';
import type { FrequentSection, RoutePoint } from '@/types';

/** A single activity's trace through the section */
export interface ActivityTrace {
  activityId: string;
  /** The portion of the GPS track that overlaps with the section */
  points: [number, number][];
}

interface SectionRowProps {
  section: FrequentSection;
  /** Optional pre-loaded activity traces for this section */
  activityTraces?: ActivityTrace[];
  onPress?: () => void;
}

// Sport type to icon mapping
const sportIcons: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Run: 'run',
  Ride: 'bike',
  Swim: 'swim',
  Walk: 'walk',
  Hike: 'hiking',
  VirtualRide: 'bike',
  VirtualRun: 'run',
};

// Format distance in km or m
function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

// Activity trace colors - muted versions of the primary color
const TRACE_COLORS = [
  'rgba(252, 76, 2, 0.15)',   // Primary orange, very muted
  'rgba(252, 76, 2, 0.20)',
  'rgba(252, 76, 2, 0.25)',
  'rgba(252, 76, 2, 0.30)',
];

const PREVIEW_WIDTH = 60;
const PREVIEW_HEIGHT = 40;
const PREVIEW_PADDING = 4;

export const SectionRow = memo(function SectionRow({
  section,
  activityTraces,
  onPress,
}: SectionRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Debug: log touch events
  const handlePressIn = () => {
    console.log('[SectionRow] PressIn! Section:', section.id);
  };

  const handlePressOut = () => {
    console.log('[SectionRow] PressOut! Section:', section.id);
  };

  const handlePress = () => {
    console.log('[SectionRow] Press! Section:', section.id, 'onPress defined:', !!onPress);
    onPress?.();
  };

  // Compute bounds that encompass section polyline and all activity traces
  const bounds = useMemo(() => {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    // Include section polyline
    if (section.polyline?.length) {
      for (const p of section.polyline) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
      }
    }

    // Include activity traces
    if (activityTraces?.length) {
      for (const trace of activityTraces) {
        for (const [lat, lng] of trace.points) {
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    }

    if (!isFinite(minLat)) {
      return null;
    }

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const range = Math.max(latRange, lngRange);

    return { minLat, maxLat, minLng, maxLng, range };
  }, [section.polyline, activityTraces]);

  // Normalize point to SVG coordinates
  const normalizePoint = (lat: number, lng: number): { x: number; y: number } => {
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: PREVIEW_PADDING + ((lng - bounds.minLng) / bounds.range) * (PREVIEW_WIDTH - 2 * PREVIEW_PADDING),
      y: PREVIEW_PADDING + (1 - (lat - bounds.minLat) / bounds.range) * (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING),
    };
  };

  // Normalize section polyline
  const sectionPolylineString = useMemo(() => {
    if (!section.polyline?.length || !bounds) return '';
    return section.polyline
      .map((p) => {
        const { x, y } = normalizePoint(p.lat, p.lng);
        return `${x},${y}`;
      })
      .join(' ');
  }, [section.polyline, bounds]);

  // Normalize activity traces
  const normalizedTraces = useMemo(() => {
    if (!activityTraces?.length || !bounds) return [];
    return activityTraces.slice(0, 4).map((trace, idx) => ({
      id: trace.activityId,
      points: trace.points
        .map(([lat, lng]) => {
          const { x, y } = normalizePoint(lat, lng);
          return `${x},${y}`;
        })
        .join(' '),
      color: TRACE_COLORS[idx % TRACE_COLORS.length],
    }));
  }, [activityTraces, bounds]);

  const hasTraces = normalizedTraces.length > 0;
  const hasSectionPolyline = sectionPolylineString.length > 0;
  const icon = sportIcons[section.sportType] || 'map-marker-path';

  return (
    <TouchableOpacity
      style={[styles.container, isDark && styles.containerDark]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Simple icon preview - SVG disabled for debugging */}
      <View style={[styles.preview, isDark && styles.previewDark]} pointerEvents="none">
        <MaterialCommunityIcons
          name={icon}
          size={24}
          color={isDark ? '#666' : colors.primary}
        />
      </View>

      {/* Section info */}
      <View style={styles.info}>
        <View style={styles.header}>
          <MaterialCommunityIcons
            name={icon}
            size={14}
            color={isDark ? '#888' : colors.textSecondary}
          />
          <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
            {section.name || `Section ${section.id.slice(-6)}`}
          </Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <MaterialCommunityIcons
              name="map-marker-distance"
              size={12}
              color={isDark ? '#666' : '#999'}
            />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {formatDistance(section.distanceMeters)}
            </Text>
          </View>

          <View style={styles.stat}>
            <MaterialCommunityIcons
              name="repeat"
              size={12}
              color={isDark ? '#666' : '#999'}
            />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {section.visitCount}x
            </Text>
          </View>

          <View style={styles.stat}>
            <MaterialCommunityIcons
              name="lightning-bolt"
              size={12}
              color={isDark ? '#666' : '#999'}
            />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {section.activityIds.length} activities
            </Text>
          </View>
        </View>

        {/* Routes using this section */}
        {section.routeIds.length > 0 && (
          <Text style={[styles.routes, isDark && styles.textMuted]} numberOfLines={1}>
            Part of {section.routeIds.length} route{section.routeIds.length > 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {/* Chevron */}
      {onPress && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? '#444' : '#CCC'}
        />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  containerDark: {
    backgroundColor: '#1E1E1E',
  },
  preview: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 6,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  previewDark: {
    backgroundColor: '#2A2A2A',
  },
  info: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  routes: {
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
});

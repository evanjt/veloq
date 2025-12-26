/**
 * Section row component.
 * Displays a frequently-traveled road section with polyline preview and stats.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { colors, spacing, layout } from '@/theme';
import type { FrequentSection } from '@/types';

interface SectionRowProps {
  section: FrequentSection;
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

export const SectionRow = memo(function SectionRow({ section, onPress }: SectionRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Normalize polyline points to fit in preview
  const normalizedPoints = useMemo(() => {
    if (!section.polyline || section.polyline.length < 2) {
      return [];
    }

    const lats = section.polyline.map((p) => p.lat);
    const lngs = section.polyline.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const range = Math.max(latRange, lngRange);

    // Normalize to 0-1, center in the larger dimension
    const width = 60;
    const height = 40;
    const padding = 4;

    return section.polyline.map((p) => ({
      x: padding + ((p.lng - minLng) / range) * (width - 2 * padding),
      y: padding + (1 - (p.lat - minLat) / range) * (height - 2 * padding),
    }));
  }, [section.polyline]);

  const polylineString = normalizedPoints.map((p) => `${p.x},${p.y}`).join(' ');

  const icon = sportIcons[section.sportType] || 'map-marker-path';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        isDark && styles.containerDark,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      {/* Polyline preview */}
      <View style={[styles.preview, isDark && styles.previewDark]}>
        {normalizedPoints.length > 1 ? (
          <Svg width={60} height={40}>
            <Polyline
              points={polylineString}
              fill="none"
              stroke={colors.primary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : (
          <MaterialCommunityIcons
            name="map-marker-path"
            size={24}
            color={isDark ? '#444' : '#CCC'}
          />
        )}
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
    </Pressable>
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
  pressed: {
    opacity: 0.7,
  },
  preview: {
    width: 60,
    height: 40,
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

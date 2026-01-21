/**
 * Section row component.
 * Displays a frequently-traveled road section with polyline preview and stats.
 * Now shows activity traces overlaid on section for richer visualization.
 *
 * Supports both full sections (FrequentSection) and lightweight summaries (SectionSummary).
 * When using summaries, the polyline is lazy-loaded on-demand.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useSectionPolyline } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline, G } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout } from '@/theme';
import { debug, formatDistance, getBoundsFromPoints } from '@/lib';
import type { FrequentSection, RoutePoint } from '@/types';
import type { SectionSummary } from 'route-matcher-native';

const log = debug.create('SectionRow');

/** A single activity's trace through the section */
export interface ActivityTrace {
  activityId: string;
  /** The portion of the GPS track that overlaps with the section */
  points: [number, number][];
}

/**
 * Section data that can be displayed in a row.
 * Supports both full FrequentSection and lightweight SectionSummary.
 */
interface SectionRowData {
  id: string;
  name?: string;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  /** Number of activities (from activityCount or activityIds.length) */
  activityCount: number;
  /** Number of routes (optional, only in full FrequentSection) */
  routeCount?: number;
  /** Polyline (optional - will be lazy-loaded if not provided) */
  polyline?: RoutePoint[];
}

interface SectionRowProps {
  /** Section data - can be FrequentSection or SectionSummary */
  section: FrequentSection | SectionSummary | SectionRowData;
  /** Optional pre-loaded activity traces for this section */
  activityTraces?: ActivityTrace[];
  onPress?: () => void;
}

/**
 * Normalize section data to a common format.
 * Handles both FrequentSection (with polyline, activityIds, routeIds) and
 * SectionSummary (lightweight, no polyline).
 */
function normalizeSectionData(
  section: FrequentSection | SectionSummary | SectionRowData
): SectionRowData {
  // Check if it's a FrequentSection (has activityIds array)
  if ('activityIds' in section && Array.isArray(section.activityIds)) {
    return {
      id: section.id,
      name: section.name,
      sportType: section.sportType,
      distanceMeters: section.distanceMeters,
      visitCount: section.visitCount,
      activityCount: section.activityIds.length,
      routeCount: 'routeIds' in section ? section.routeIds?.length : undefined,
      polyline: section.polyline,
    };
  }
  // Check if it's a SectionSummary (has activityCount number)
  if ('activityCount' in section && typeof section.activityCount === 'number') {
    return {
      id: section.id,
      name: section.name,
      sportType: section.sportType,
      distanceMeters: section.distanceMeters,
      visitCount: section.visitCount,
      activityCount: section.activityCount,
      routeCount: undefined, // Not available in summary
      polyline: undefined, // Will be lazy-loaded
    };
  }
  // Already normalized
  return section as SectionRowData;
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

// Activity trace colors - muted versions of the primary color
const TRACE_COLORS = [
  'rgba(252, 76, 2, 0.15)', // Primary orange, very muted
  'rgba(252, 76, 2, 0.20)',
  'rgba(252, 76, 2, 0.25)',
  'rgba(252, 76, 2, 0.30)',
];

const PREVIEW_WIDTH = 60;
const PREVIEW_HEIGHT = 40;
const PREVIEW_PADDING = 4;

export const SectionRow = memo(function SectionRow({
  section: rawSection,
  activityTraces,
  onPress,
}: SectionRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // Normalize section data to common format
  const section = useMemo(() => normalizeSectionData(rawSection), [rawSection]);

  // Lazy-load polyline if not provided (e.g., when using SectionSummary)
  // This is fast - Rust query with LRU caching
  const { polyline: lazyPolyline } = useSectionPolyline(
    section.polyline ? null : section.id // Only fetch if not already provided
  );

  // Use provided polyline or lazy-loaded one
  const polyline = section.polyline || lazyPolyline;

  // Debug: log touch events
  const handlePressIn = () => {
    log.log('PressIn! Section:', section.id);
  };

  const handlePressOut = () => {
    log.log('PressOut! Section:', section.id);
  };

  const handlePress = () => {
    log.log('Press! Section:', section.id, 'onPress defined:', !!onPress);
    onPress?.();
  };

  // Compute bounds from section polyline only (not activity traces)
  // This ensures the thumbnail accurately represents the section geometry
  const bounds = useMemo(() => {
    if (!polyline?.length) return null;

    // Use utility for bounds calculation
    const mapBounds = getBoundsFromPoints(polyline);
    if (!mapBounds) return null;

    // Extract min/max from MapLibre bounds format
    const [minLng, minLat] = mapBounds.sw;
    const [maxLng, maxLat] = mapBounds.ne;

    // Calculate range for SVG normalization
    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const range = Math.max(latRange, lngRange);

    return { minLat, maxLat, minLng, maxLng, range };
  }, [polyline]);

  // Normalize point to SVG coordinates
  const normalizePoint = (lat: number, lng: number): { x: number; y: number } => {
    if (!bounds) return { x: 0, y: 0 };
    return {
      x:
        PREVIEW_PADDING +
        ((lng - bounds.minLng) / bounds.range) * (PREVIEW_WIDTH - 2 * PREVIEW_PADDING),
      y:
        PREVIEW_PADDING +
        (1 - (lat - bounds.minLat) / bounds.range) * (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING),
    };
  };

  // Normalize section polyline
  const sectionPolylineString = useMemo(() => {
    if (!polyline?.length || !bounds) return '';
    return polyline
      .map((p) => {
        const { x, y } = normalizePoint(p.lat, p.lng);
        return `${x},${y}`;
      })
      .join(' ');
  }, [polyline, bounds]);

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
      {/* Section polyline preview with activity traces */}
      <View style={[styles.preview, isDark && styles.previewDark]} pointerEvents="none">
        {hasSectionPolyline ? (
          <Svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
            {/* Activity traces underneath (if any) */}
            {hasTraces && (
              <G>
                {normalizedTraces.map((trace) => (
                  <Polyline
                    key={trace.id}
                    points={trace.points}
                    fill="none"
                    stroke={trace.color}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </G>
            )}
            {/* Section polyline on top */}
            <Polyline
              points={sectionPolylineString}
              fill="none"
              stroke={isDark ? colors.chartBlue : colors.primary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : (
          <MaterialCommunityIcons
            name={icon}
            size={24}
            color={isDark ? darkColors.textMuted : colors.primary}
          />
        )}
      </View>

      {/* Section info */}
      <View style={styles.info}>
        <View style={styles.header}>
          <MaterialCommunityIcons
            name={icon}
            size={14}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
            {section.name || `${section.sportType} Section`}
          </Text>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <MaterialCommunityIcons
              name="map-marker-distance"
              size={12}
              color={isDark ? darkColors.textMuted : colors.textMuted}
            />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {formatDistance(section.distanceMeters)}
            </Text>
          </View>

          <View style={styles.stat}>
            <MaterialCommunityIcons name="repeat" size={12} color={isDark ? '#666' : '#999'} />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {section.visitCount} {t('sections.traversals')}
            </Text>
          </View>

          <View style={styles.stat}>
            <MaterialCommunityIcons
              name="lightning-bolt"
              size={12}
              color={isDark ? darkColors.textMuted : colors.textMuted}
            />
            <Text style={[styles.statText, isDark && styles.textMuted]}>
              {section.activityCount} {t('routes.activities')}
            </Text>
          </View>
        </View>

        {/* Routes using this section (only shown if routeCount is available) */}
        {section.routeCount !== undefined && section.routeCount > 0 && (
          <Text style={[styles.routes, isDark && styles.textMuted]} numberOfLines={1}>
            {section.routeCount > 1
              ? t('routes.partOfRoutesPlural', {
                  count: section.routeCount,
                })
              : t('routes.partOfRoutes', { count: section.routeCount })}
          </Text>
        )}
      </View>

      {/* Chevron */}
      {onPress && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.border}
        />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
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
    backgroundColor: darkColors.surfaceCard,
  },
  preview: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 6,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  previewDark: {
    backgroundColor: darkColors.surfaceElevated,
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
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});

/**
 * Section row component.
 * Displays a frequently-traveled road section with polyline preview and stats.
 * Now shows activity traces overlaid on section for richer visualization.
 *
 * Supports both full sections (FrequentSection) and lightweight summaries (SectionSummary).
 * When using summaries, the polyline is lazy-loaded on-demand.
 */

import React, { memo, useMemo, useId } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useSectionPolyline, useMetricSystem } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline, G, Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { debug, formatDistance, getBoundsFromPoints, getActivityColor } from '@/lib';
import type { ActivityType, FrequentSection, RoutePoint } from '@/types';
import type { SectionSummary } from 'veloqrs';

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
    // Use activityCount if available (preserved from SectionSummary), else count array
    const activityCount =
      'activityCount' in section && typeof section.activityCount === 'number'
        ? section.activityCount
        : section.activityIds.length;
    return {
      id: section.id,
      name: section.name,
      sportType: section.sportType,
      distanceMeters: section.distanceMeters,
      visitCount: section.visitCount,
      activityCount,
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

const PREVIEW_WIDTH = 56;
const PREVIEW_HEIGHT = 40;
const PREVIEW_PADDING = 4;

export const SectionRow = memo(function SectionRow({
  section: rawSection,
  activityTraces,
  onPress,
}: SectionRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  // Unique ID for SVG gradient to avoid collisions between multiple instances
  const uniqueId = useId();
  const gradientId = `sectionGradient-${uniqueId}`;

  // Normalize section data to common format
  const section = useMemo(() => normalizeSectionData(rawSection), [rawSection]);

  // Lazy-load polyline if not provided (e.g., when using SectionSummary)
  // This is fast - Rust query with LRU caching
  // Note: Check length, not truthiness - empty array [] is truthy but means "not loaded"
  const shouldLazyLoad = !section.polyline?.length;
  const { polyline: lazyPolyline } = useSectionPolyline(shouldLazyLoad ? section.id : null);

  // Use provided polyline or lazy-loaded one
  // Note: Check length, not truthiness - empty array [] is truthy
  const polyline = section.polyline?.length ? section.polyline : lazyPolyline;

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

  // Get activity color for the sport type
  const activityColor = getActivityColor(section.sportType as ActivityType);

  // Background colors for map-like appearance
  const bgColor = isDark ? '#1a2a1a' : '#e8f4e8';
  const gridColor = isDark ? '#2a3a2a' : '#d0e8d0';

  // Get start/end points for markers
  const polylinePoints = useMemo(() => {
    if (!polyline?.length || !bounds) return null;
    const normalized = polyline.map((p) => normalizePoint(p.lat, p.lng));
    return {
      start: normalized[0],
      end: normalized[normalized.length - 1],
    };
  }, [polyline, bounds]);

  return (
    <TouchableOpacity
      testID={`section-row-${section.id}`}
      style={[styles.container, isDark && styles.containerDark]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Section polyline preview with map-like backdrop */}
      <View style={styles.previewBox} pointerEvents="none">
        {hasSectionPolyline ? (
          <Svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
                <Stop offset="1" stopColor={isDark ? '#0d1a0d' : '#d4e8d4'} stopOpacity="1" />
              </LinearGradient>
            </Defs>

            {/* Map-like background */}
            <Rect
              x="0"
              y="0"
              width={PREVIEW_WIDTH}
              height={PREVIEW_HEIGHT}
              fill={`url(#${gradientId})`}
              rx="4"
            />

            {/* Subtle grid lines for map effect */}
            <Polyline
              points={`${PREVIEW_WIDTH / 3},0 ${PREVIEW_WIDTH / 3},${PREVIEW_HEIGHT}`}
              stroke={gridColor}
              strokeWidth={0.5}
              strokeOpacity={0.5}
            />
            <Polyline
              points={`${(2 * PREVIEW_WIDTH) / 3},0 ${(2 * PREVIEW_WIDTH) / 3},${PREVIEW_HEIGHT}`}
              stroke={gridColor}
              strokeWidth={0.5}
              strokeOpacity={0.5}
            />
            <Polyline
              points={`0,${PREVIEW_HEIGHT / 2} ${PREVIEW_WIDTH},${PREVIEW_HEIGHT / 2}`}
              stroke={gridColor}
              strokeWidth={0.5}
              strokeOpacity={0.5}
            />

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

            {/* Route shadow for depth */}
            <Polyline
              points={sectionPolylineString}
              fill="none"
              stroke="#000000"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.15}
              transform="translate(0.5, 0.5)"
            />

            {/* Section polyline on top */}
            <Polyline
              points={sectionPolylineString}
              fill="none"
              stroke={activityColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Start marker (green) */}
            {polylinePoints && (
              <>
                <Circle
                  cx={polylinePoints.start.x}
                  cy={polylinePoints.start.y}
                  r={3}
                  fill={colors.success}
                />
                <Circle
                  cx={polylinePoints.start.x}
                  cy={polylinePoints.start.y}
                  r={2}
                  fill="#FFFFFF"
                />
              </>
            )}

            {/* End marker (red) */}
            {polylinePoints && (
              <>
                <Circle
                  cx={polylinePoints.end.x}
                  cy={polylinePoints.end.y}
                  r={3}
                  fill={colors.error}
                />
                <Circle cx={polylinePoints.end.x} cy={polylinePoints.end.y} r={2} fill="#FFFFFF" />
              </>
            )}
          </Svg>
        ) : (
          <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
            <MaterialCommunityIcons name={icon} size={18} color={isDark ? '#555' : '#BBB'} />
          </View>
        )}
      </View>

      {/* Section info */}
      <View style={styles.infoContainer}>
        <Text style={[styles.sectionName, isDark && styles.textLight]} numberOfLines={1}>
          {section.name || `${section.sportType} Section`}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, isDark && styles.textMuted]}>
            {formatDistance(section.distanceMeters, isMetric)}
          </Text>
          <Text style={[styles.metaText, isDark && styles.textMuted]}>
            {section.visitCount}× {t('sections.traversals')}
          </Text>
          {section.routeCount !== undefined && section.routeCount > 0 && (
            <Text style={[styles.routesText, { color: colors.primary }]}>
              {section.routeCount}{' '}
              {section.routeCount === 1
                ? t('navigation.routes').slice(0, -1)
                : t('navigation.routes').toLowerCase()}
            </Text>
          )}
        </View>
      </View>

      {/* Activity count badge */}
      <View style={styles.countBadge}>
        <Text style={styles.countText}>{section.activityCount}</Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: 10,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  previewBox: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
  },
  previewPlaceholder: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewPlaceholderDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  sectionName: {
    fontSize: typography.bodyCompact.fontSize,
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
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  routesText: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    gap: 2,
  },
  countText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});

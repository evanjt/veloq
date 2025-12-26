import React, { useMemo, useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, Pressable, Dimensions, StatusBar, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MapLibreGL, { Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { useRouteMatchStore, useMapPreferences } from '@/providers';
import { useActivities } from '@/hooks';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
} from '@/lib';
import { getMapStyle } from '@/components/maps';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { Activity, FrequentSection, RoutePoint } from '@/types';

const { MapView } = MapLibreGL;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.40);

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
}

function ActivityRow({ activity, isDark }: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const activityColor = getActivityColor(activity.type);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        pressed && styles.activityRowPressed,
      ]}
    >
      <View style={[styles.activityIcon, { backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons
          name={getActivityIcon(activity.type)}
          size={18}
          color={activityColor}
        />
      </View>
      <View style={styles.activityInfo}>
        <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
          {activity.name}
        </Text>
        <Text style={[styles.activityDate, isDark && styles.textMuted]}>
          {formatRelativeDate(activity.start_date_local)}
        </Text>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {formatDistance(activity.distance)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(activity.moving_time)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? '#555' : '#CCC'}
      />
    </Pressable>
  );
}

function SectionMapView({
  section,
  height = 200,
}: {
  section: FrequentSection;
  height?: number;
}) {
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(section.sportType as any);
  const activityColor = getActivityColor(section.sportType as any);

  const bounds = useMemo(() => {
    if (!section.polyline || section.polyline.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const point of section.polyline) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }

    const latPad = (maxLat - minLat) * 0.15;
    const lngPad = (maxLng - minLng) * 0.15;

    return {
      ne: [maxLng + lngPad, maxLat + latPad] as [number, number],
      sw: [minLng - lngPad, minLat - latPad] as [number, number],
    };
  }, [section.polyline]);

  const routeGeoJSON = useMemo(() => {
    if (!section.polyline || section.polyline.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: section.polyline.map(p => [p.lng, p.lat]),
      },
    };
  }, [section.polyline]);

  const styleUrl = getMapStyle(mapStyle);

  const startPoint = section.polyline?.[0];
  const endPoint = section.polyline?.[section.polyline.length - 1];

  if (!bounds || !routeGeoJSON) {
    return (
      <View style={[styles.placeholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons
          name="map-marker-off"
          size={32}
          color={activityColor}
        />
      </View>
    );
  }

  return (
    <View style={[styles.mapContainer, { height }]}>
      <MapView
        style={styles.map}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Camera
          bounds={bounds}
          padding={{ paddingTop: 50, paddingRight: 50, paddingBottom: 50, paddingLeft: 50 }}
          animationDuration={0}
        />

        <ShapeSource id="sectionRoute" shape={routeGeoJSON}>
          <LineLayer
            id="sectionLine"
            style={{
              lineColor: activityColor,
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>

        {startPoint && (
          <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.startMarker]}>
                <MaterialCommunityIcons name="play" size={12} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}

        {endPoint && (
          <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.endMarker]}>
                <MaterialCommunityIcons name="flag-checkered" size={12} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}
      </MapView>
    </View>
  );
}

export default function SectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  // Find the section from the route match store
  const section = useRouteMatchStore((s) =>
    s.cache?.frequentSections?.find((sec) => sec.id === id) || null
  );

  // Calculate date range for fetching activities
  const { oldest, newest } = useMemo(() => {
    if (!section || section.activityIds.length === 0) {
      return { oldest: undefined, newest: undefined };
    }
    // We don't have dates in section, so fetch a wide range
    // and filter by activity IDs
    const now = new Date();
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    return {
      oldest: yearAgo.toISOString().split('T')[0],
      newest: now.toISOString().split('T')[0],
    };
  }, [section]);

  const { data: allActivities, isLoading } = useActivities({
    oldest,
    newest,
    includeStats: false,
  });

  // Filter to only activities in this section
  const sectionActivities = useMemo(() => {
    if (!section || !allActivities) return [];
    const idsSet = new Set(section.activityIds);
    const seen = new Set<string>();
    return allActivities.filter((a) => {
      if (!idsSet.has(a.id) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [section, allActivities]);

  if (!section) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#FFFFFF' : colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="road-variant"
            size={48}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            Section not found
          </Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(section.sportType as any);
  const iconName = getActivityIcon(section.sportType as any);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          <SectionMapView section={section} height={MAP_HEIGHT} />

          {/* Gradient overlay at bottom */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.mapGradient}
            pointerEvents="none"
          />

          {/* Floating header - back button */}
          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Section info overlay at bottom */}
          <View style={styles.infoOverlay}>
            <View style={styles.sectionNameRow}>
              <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.heroSectionName} numberOfLines={2}>
                {section.name}
              </Text>
            </View>

            {/* Stats row */}
            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(section.distanceMeters)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.visitCount} visits</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.activityIds.length} activities</Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              Activities
            </Text>

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : sectionActivities.length === 0 ? (
              <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
                No activities found
              </Text>
            ) : (
              <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
                {sectionActivities.map((activity, index) => (
                  <React.Fragment key={activity.id}>
                    <ActivityRow activity={activity} isDark={isDark} />
                    {index < sectionActivities.length - 1 && (
                      <View style={[styles.divider, isDark && styles.dividerDark]} />
                    )}
                  </React.Fragment>
                ))}
              </View>
            )}
          </View>

          {/* Routes that include this section */}
          {section.routeIds.length > 0 && (
            <View style={styles.routesSection}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
                Part of {section.routeIds.length} route{section.routeIds.length > 1 ? 's' : ''}
              </Text>
              <Text style={[styles.routesHint, isDark && styles.textMuted]}>
                This section appears in multiple routes you've completed
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  heroSection: {
    height: MAP_HEIGHT,
    position: 'relative',
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSectionName: {
    flex: 1,
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  heroStat: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroStatDivider: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: spacing.xs,
  },
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyActivities: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  activitiesCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  activitiesCardDark: {
    backgroundColor: darkColors.surface,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  activityRowDark: {},
  activityRowPressed: {
    opacity: 0.7,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: typography.bodySmall.fontSize + 1,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  activityStats: {
    alignItems: 'flex-end',
  },
  activityDistance: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: opacity.overlay.light,
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  routesSection: {
    marginBottom: spacing.lg,
  },
  routesHint: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: layout.borderRadius,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.textOnDark,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  startMarker: {
    backgroundColor: colors.success,
  },
  endMarker: {
    backgroundColor: colors.error,
  },
});

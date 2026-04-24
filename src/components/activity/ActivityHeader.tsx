import React from 'react';
import { View, TouchableOpacity, Pressable, StyleSheet, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityMapView, type SectionOverlay } from '@/components/maps/ActivityMapView';
import type {
  SectionCreationResult,
  SectionCreationError,
} from '@/components/maps/ActivityMapView';
import type { CreationState } from '@/components/maps/SectionCreationOverlay';
import { ComponentErrorBoundary } from '@/components/ui';
import type { ActivityDetail, ActivityStreams } from '@/types';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import type { MapStyleType } from '@/components/maps/mapStyles';
import { formatDistance, formatDuration, formatElevation, formatDateTime } from '@/lib';
import { routeEngine } from 'veloqrs';
import { colors, spacing, typography } from '@/theme';

interface LatLng {
  latitude: number;
  longitude: number;
}

interface ActivityHeaderProps {
  activity: ActivityDetail;
  activityId: string;
  coordinates: LatLng[];
  /** Activity streams — required for gradient-based line coloring on the map */
  streams?: ActivityStreams | null;
  isMetric: boolean;
  isDark: boolean;
  debugEnabled: boolean;
  insetTop: number;
  mapHeight: number;
  // Map props
  highlightIndex: number | null;
  sectionCreationMode: boolean;
  sectionCreationState: CreationState | undefined;
  sectionCreationError: SectionCreationError | null;
  onSectionCreated: (result: SectionCreationResult) => void;
  onCreationCancelled: () => void;
  onCreationErrorDismiss: () => void;
  on3DModeChange: (is3D: boolean) => void;
  onStyleChange: (style: MapStyleType) => void;
  onCameraCapture: (camera: TerrainCamera) => void;
  initial3DCamera: TerrainCamera | null;
  // Tab-dependent overlays
  activeTab: string;
  routeOverlayCoordinates: LatLng[] | null;
  sectionOverlays: SectionOverlay[] | null;
  highlightedSectionId: string | null;
  onSectionMarkerPress?: (sectionId: string) => void;
}

export const ActivityHeader = React.memo(function ActivityHeader({
  activity,
  activityId,
  coordinates,
  streams,
  isMetric,
  isDark,
  debugEnabled,
  insetTop,
  mapHeight,
  highlightIndex,
  sectionCreationMode,
  sectionCreationState,
  sectionCreationError,
  onSectionCreated,
  onCreationCancelled,
  onCreationErrorDismiss,
  on3DModeChange,
  onStyleChange,
  onCameraCapture,
  initial3DCamera,
  activeTab,
  routeOverlayCoordinates,
  sectionOverlays,
  highlightedSectionId,
  onSectionMarkerPress,
}: ActivityHeaderProps) {
  return (
    <View testID="activity-detail-content" style={[styles.heroSection, { height: mapHeight }]}>
      {/* Map - full bleed */}
      <View style={styles.mapContainer}>
        <ComponentErrorBoundary componentName="Activity Map">
          <ActivityMapView
            coordinates={coordinates}
            polyline={activity.polyline}
            activityType={activity.type}
            activityId={activity.id}
            country={activity.country}
            streams={streams}
            height={mapHeight}
            showStyleToggle={!sectionCreationMode}
            showAttribution={true}
            highlightIndex={highlightIndex}
            enableFullscreen={!sectionCreationMode}
            on3DModeChange={on3DModeChange}
            onStyleChange={onStyleChange}
            onCameraCapture={onCameraCapture}
            initial3DCamera={initial3DCamera}
            creationMode={sectionCreationMode}
            creationState={sectionCreationState}
            creationError={sectionCreationError}
            onSectionCreated={onSectionCreated}
            onCreationCancelled={onCreationCancelled}
            onCreationErrorDismiss={onCreationErrorDismiss}
            routeOverlay={activeTab === 'routes' ? routeOverlayCoordinates : null}
            sectionOverlays={
              activeTab === 'sections'
                ? sectionOverlays
                : activeTab === 'charts'
                  ? (sectionOverlays?.filter((o) => o.isPR) ?? null)
                  : null
            }
            activeTab={activeTab}
            highlightedSectionId={activeTab === 'sections' ? highlightedSectionId : null}
            onSectionMarkerPress={onSectionMarkerPress}
          />
        </ComponentErrorBoundary>
      </View>

      {/* Gradient overlay at bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={styles.mapGradient}
        pointerEvents="none"
      />

      {/* Floating header - back button */}
      <View style={[styles.floatingHeader, { paddingTop: insetTop }]} pointerEvents="box-none">
        <TouchableOpacity
          testID="activity-detail-back"
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} pointerEvents="none" />
      </View>

      {/* Activity info overlay at bottom */}
      <View style={styles.infoOverlay} pointerEvents="box-none">
        <Pressable
          onLongPress={
            debugEnabled
              ? () => {
                  const doClone = (n: number) => {
                    const created = routeEngine.debugCloneActivity(activityId, n);
                    Alert.alert('Done', `Created ${created} clones`);
                  };
                  Alert.alert(
                    'Clone for Testing',
                    `Clone "${activity.name}" to stress test sections and routes.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: '10 clones', onPress: () => doClone(10) },
                      {
                        text: 'More...',
                        onPress: () => {
                          Alert.alert('Clone Amount', 'Choose number of clones:', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: '50 clones', onPress: () => doClone(50) },
                            {
                              text: '100 clones',
                              onPress: () => doClone(100),
                            },
                          ]);
                        },
                      },
                    ]
                  );
                }
              : undefined
          }
        >
          <Text style={styles.activityName} numberOfLines={1}>
            {activity.name}
          </Text>
        </Pressable>

        {/* Date and inline stats */}
        <View style={styles.metaRow}>
          <Text style={styles.activityDate}>{formatDateTime(activity.start_date_local)}</Text>
          <View style={styles.inlineStats}>
            <Text testID="activity-detail-distance" style={styles.inlineStat}>
              {formatDistance(activity.distance, isMetric)}
            </Text>
            <Text style={styles.inlineStatDivider}>·</Text>
            <Text testID="activity-detail-duration" style={styles.inlineStat}>
              {formatDuration(activity.moving_time)}
            </Text>
            <Text style={styles.inlineStatDivider}>·</Text>
            <Text style={styles.inlineStat}>
              {formatElevation(activity.total_elevation_gain, isMetric)}
            </Text>
          </View>
        </View>

        {/* Location */}
        {(activity.locality || activity.country) && (
          <Text style={styles.locationText}>
            {[activity.locality, activity.country].filter(Boolean).join(', ')}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  heroSection: {
    position: 'relative',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md + spacing.sm,
    zIndex: 5,
  },
  activityName: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  activityDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: 'rgba(255,255,255,0.85)',
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineStat: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inlineStatDivider: {
    fontSize: typography.bodyCompact.fontSize,
    color: 'rgba(255,255,255,0.5)',
    marginHorizontal: 6,
  },
  locationText: {
    fontSize: typography.label.fontSize,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

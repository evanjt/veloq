import React from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { ActivityMapView, type SectionOverlay } from '@/features/maps/components/ActivityMapView';
import type {
  SectionCreationResult,
  SectionCreationError,
} from '@/features/maps/components/ActivityMapView';
import type { CreationState } from '@/features/maps/components/SectionCreationOverlay';
import { ComponentErrorBoundary, DetailHero } from '@/shared/ui';
import type { ActivityDetail, ActivityStreams } from '@/types';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';
import type { MapStyleType } from '@/features/maps/components/mapStyles';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatDateTime,
} from '@/shared/format/format';
import { routeEngine } from 'veloqrs';
import { colors, colorWithOpacity, opacity, spacing, typography } from '@/theme';

interface LatLng {
  latitude: number;
  longitude: number;
}

interface ActivityHeaderProps {
  activity: ActivityDetail;
  activityId: string;
  coordinates: LatLng[];
  /** Activity streams - required for gradient-based line coloring on the map */
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
    <DetailHero
      height={mapHeight}
      insetTop={insetTop}
      onBack={() => router.back()}
      backTestID="activity-detail-back"
      containerTestID="activity-detail-content"
      overlay={
        <>
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

          {(activity.locality || activity.country) && (
            <Text style={styles.locationText}>
              {[activity.locality, activity.country].filter(Boolean).join(', ')}
            </Text>
          )}
        </>
      }
    >
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
    </DetailHero>
  );
});

const styles = StyleSheet.create({
  activityName: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.full,
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
    color: colorWithOpacity(colors.textOnDark, 0.85),
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineStat: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.heavy,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inlineStatDivider: {
    fontSize: typography.bodyCompact.fontSize,
    color: colorWithOpacity(colors.textOnDark, 0.5),
    marginHorizontal: 6,
  },
  locationText: {
    fontSize: typography.label.fontSize,
    color: colorWithOpacity(colors.textOnDark, 0.7),
    marginTop: 2,
    textShadowColor: opacity.overlay.heavy,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

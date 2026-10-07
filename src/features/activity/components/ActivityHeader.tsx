import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import {
  ActivityMapView,
  ATTRIBUTION_CLEARANCE,
  type CreationState,
  type MapStyleType,
  useMapControlColumn,
  SectionCreationError,
  SectionCreationResult,
  type SectionOverlay,
  type TerrainCamera,
} from '@/features/maps';
import { ComponentErrorBoundary, DetailHero, pressable, pressRipple } from '@/shared/ui';
import { heroTextStyles } from '@/shared/ui/DetailHero';
import type { ActivityDetail, ActivityStreams } from '@/types';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatDateTime,
} from '@/shared/format/format';
import { engine } from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';
import { colors, colorWithOpacity, mapTextShadow, opacity, spacing, typography } from '@/theme';

interface ActivityHeaderProps {
  activity: ActivityDetail;
  activityId: string;
  coordinates: LatLng[];
  /** Activity streams - required for gradient-based line coloring on the map */
  streams?: ActivityStreams | null;
  isMetric: boolean;
  debugEnabled: boolean;
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
  sectionRowLabels?: ReadonlyMap<string, string> | undefined;
  highlightedSectionId: string | null;
  onSectionMarkerPress?: ((sectionId: string) => void) | undefined;
}

export const ActivityHeader = React.memo(function ActivityHeader({
  activity,
  activityId,
  coordinates,
  streams,
  isMetric,
  debugEnabled,
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
  sectionRowLabels,
  highlightedSectionId,
  onSectionMarkerPress,
}: ActivityHeaderProps) {
  // The satellite credit wraps to two rows at phone width, so the reservation
  // comes from what the pill measured. The constant is only the first guess.
  const controlColumn = useMapControlColumn(mapHeight);
  const [attributionClearance, setAttributionClearance] = useState(ATTRIBUTION_CLEARANCE);
  const visibleSectionOverlays =
    activeTab === 'sections' || activeTab === 'charts' ? sectionOverlays : null;

  return (
    <DetailHero
      height={mapHeight}
      containerTestID="activity-detail-content"
      attributionClearance={attributionClearance}
      overlayInsetEnd={controlColumn.footprint}
      overlay={
        <>
          {debugEnabled ? (
            <Pressable
              testID="activity-detail-name"
              onLongPress={() => {
                const doClone = (n: number) => {
                  const created = engine.debugCloneActivity(activityId, n);
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
              }}
              style={(state) => [pressable()(state), styles.namePressable]}
              android_ripple={pressRipple}
            >
              <Text style={heroTextStyles.name} numberOfLines={1}>
                {activity.name}
              </Text>
            </Pressable>
          ) : (
            <Text
              testID="activity-detail-name"
              pointerEvents="none"
              style={heroTextStyles.name}
              numberOfLines={1}
            >
              {activity.name}
            </Text>
          )}

          <View style={styles.metaRow} pointerEvents="none">
            <Text style={styles.activityDate}>{formatDateTime(activity.start_date_local)}</Text>
            <View style={styles.inlineStats}>
              <Text testID="activity-detail-distance" style={heroTextStyles.stat}>
                {formatDistance(activity.distance, isMetric)}
              </Text>
              <Text style={heroTextStyles.statDivider}>·</Text>
              <Text testID="activity-detail-duration" style={heroTextStyles.stat}>
                {formatDuration(activity.moving_time)}
              </Text>
              <Text style={heroTextStyles.statDivider}>·</Text>
              <Text style={heroTextStyles.stat}>
                {formatElevation(activity.total_elevation_gain, isMetric)}
              </Text>
            </View>
          </View>
        </>
      }
    >
      <ComponentErrorBoundary componentName="Activity Map">
        <ActivityMapView
          coordinates={coordinates}
          activityType={activity.type}
          activityId={activity.id}
          streams={streams}
          height={mapHeight}
          showStyleToggle={!sectionCreationMode}
          showAttribution={true}
          onAttributionClearanceChange={setAttributionClearance}
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
          sectionOverlays={visibleSectionOverlays}
          sectionRowLabels={sectionRowLabels}
          activeTab={activeTab}
          highlightedSectionId={activeTab === 'sections' ? highlightedSectionId : null}
          onSectionMarkerPress={onSectionMarkerPress}
        />
      </ComponentErrorBoundary>
    </DetailHero>
  );
});

const styles = StyleSheet.create({
  namePressable: {
    alignSelf: 'flex-start',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  activityDate: {
    ...typography.bodyCompact,
    color: colorWithOpacity(colors.textOnDark, 0.85),
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

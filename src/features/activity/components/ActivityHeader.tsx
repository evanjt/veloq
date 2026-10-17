import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  ActivityMapView,
  ATTRIBUTION_CLEARANCE,
  type CreationState,
  MAX_MAP_CONTROLS,
  type MapStyleType,
  useMapControlColumn,
  SectionCreationError,
  SectionCreationResult,
  type SectionOverlay,
  type TerrainCamera,
} from '@/features/maps';
import {
  ComponentErrorBoundary,
  DetailHero,
  HeroStatsRow,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { heroTextStyles } from '@/shared/ui/DetailHero';
import type { ActivityDetail, ActivityStreams } from '@/types';
import { formatDateTime } from '@/shared/format/format';
import { activityHeroStats } from '../lib/activityHeroStats';
import { engine } from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';
import { colors, mapTextShadow, opacity, spacing, typography } from '@/theme';
import { CONFIRM_HOLD_MS } from '@/shared/ui/holdDurations';
import { chooseAction, inform } from '@/shared/ui/dialog';

interface ActivityHeaderProps {
  activity: ActivityDetail;
  activityId: string;
  coordinates: LatLng[];
  /** Whether the engine holds the track, so the map draws it from the engine's URL */
  hasStoredTrack: boolean;
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
  hasStoredTrack,
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
  const { t } = useTranslation();
  // The map reports the buttons it draws, so the text reserves only their width.
  // Until it does, the reserve covers the fullest column.
  const [controlCount, setControlCount] = useState(MAX_MAP_CONTROLS);
  const controlColumn = useMapControlColumn(mapHeight, controlCount);
  // The satellite credit wraps to two rows at phone width, so the reservation
  // comes from what the pill measured. The constant is only the first guess.
  const [attributionClearance, setAttributionClearance] = useState(ATTRIBUTION_CLEARANCE);
  const visibleSectionOverlays =
    activeTab === 'sections' || activeTab === 'charts' ? sectionOverlays : null;
  const stats = activityHeroStats(activity, isMetric, t);

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
              accessibilityRole="button"
              accessibilityLabel={activity.name}
              testID="activity-detail-name"
              delayLongPress={CONFIRM_HOLD_MS}
              onLongPress={() => {
                const doClone = (n: number) => {
                  const created = engine.debugCloneActivity(activityId, n);
                  inform({ title: 'Done', message: `Created ${created} clones` });
                };
                chooseAction({
                  title: 'Clone for Testing',
                  message: `Clone "${activity.name}" to stress test sections and routes.`,
                  cancelLabel: 'Cancel',
                  actions: [
                    { label: '10 clones', onPress: () => doClone(10) },
                    {
                      label: 'More...',
                      onPress: () => {
                        chooseAction({
                          title: 'Clone Amount',
                          message: 'Choose number of clones:',
                          cancelLabel: 'Cancel',
                          actions: [
                            { label: '50 clones', onPress: () => doClone(50) },
                            { label: '100 clones', onPress: () => doClone(100) },
                          ],
                        });
                      },
                    },
                  ],
                });
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
              accessibilityRole="header"
              pointerEvents="none"
              style={heroTextStyles.name}
              numberOfLines={1}
            >
              {activity.name}
            </Text>
          )}

          <View style={styles.metaRow} pointerEvents="none">
            <Text style={styles.activityDate}>{formatDateTime(activity.start_date_local)}</Text>
            <HeroStatsRow
              testID="activity-detail-stats"
              style={styles.inlineStats}
              statTestIDs={['activity-detail-distance', 'activity-detail-duration']}
              stats={stats}
            />
          </View>
        </>
      }
    >
      <ComponentErrorBoundary part="activityMap" debugName="Activity Map">
        <ActivityMapView
          coordinates={coordinates}
          hasStoredTrack={hasStoredTrack}
          activityType={activity.type}
          activityId={activity.id}
          streams={streams}
          height={mapHeight}
          showStyleToggle={!sectionCreationMode}
          showAttribution={true}
          onAttributionClearanceChange={setAttributionClearance}
          onControlCountChange={setControlCount}
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
    color: colors.textOnDark,
    textShadowColor: opacity.overlay.full,
    ...mapTextShadow,
  },
  inlineStats: {
    marginTop: 0,
    flexWrap: 'nowrap',
  },
});

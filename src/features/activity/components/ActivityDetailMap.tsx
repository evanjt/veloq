/**
 * An activity's map filling its host's map screen, under the sheet that holds the activity's
 * card. It reads the activity from the engine as the card does, and what the card shares (the tab
 * on show, the chart's scrub point, the section a row highlights) from the host's entry, so a
 * scrub renders the map and not the card. The track is fitted to the part of the map the header
 * and the sheet's settled stop leave visible.
 *
 * Drawing a new section is a tool on the map. The Sections tab enters it through the stop store,
 * which puts the sheet away; the map then takes the two taps and draws the tool's bar, and saving,
 * cancelling or back ends the tool and presents the sheet again at the stop it had.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  ActivityMapView,
  resolveTerrain3D,
  submitSectionCreation,
  useInMapSurfaceSlot,
  type CreationState,
  type SectionCreationError,
  type SectionCreationResult,
  type TerrainCamera,
} from '@/features/maps';
import { useCustomSections, useRouteSettings, useSectionMatches } from '@/features/routes';
import { useMapPreferences } from '@/features/settings';
import { mapSheetHostKey, useHostCardCount } from '@/shared/app/mapSheetHost';
import { useMapSheetHost } from '@/shared/app/MapSheetHost';
import { mapSheetCoveredHeight, useMapSheetStop } from '@/shared/app/mapSheetStop';
import { ComponentErrorBoundary, showNotice } from '@/shared/ui';
import { toActivityType } from '@/types';
import type { Section as NativeSection } from 'veloqrs';
import { useActivity, useActivityDetailStreams, useSectionOverlays } from '../hooks';
import { useActivityDetailData } from '../hooks/useActivityDetailData';
import { useActivityMapChoices } from '../hooks/useActivityMapChoices';
import { groupSectionEncounters, sectionRowLabels } from '../lib/groupSectionEncounters';
import { routeOverlayLine } from '../lib/routeOverlayLine';
import {
  activityCardWriter,
  useCardActiveTab,
  useCardHighlightIndex,
  useCardHighlightedSection,
} from '../lib/activityCardState';

/** Stable empty list so the custom-sections hook keeps skipping its own read. */
const NO_CUSTOM_SECTIONS: NativeSection[] = [];

export interface ActivityDetailMapProps {
  /** The activity's id. */
  activityId: string;
}

export function ActivityDetailMap({ activityId: id }: ActivityDetailMapProps) {
  const { t } = useTranslation();
  // An activity card pushed onto another subject's host reads that host's entry.
  const hostKey = useMapSheetHost()?.key ?? mapSheetHostKey('activity', id);
  const inSlot = useInMapSurfaceSlot();
  const { data: activity } = useActivity(id);
  const { data: streams, coordinates } = useActivityDetailStreams(id);
  const { data: detail } = useActivityDetailData(id);

  const activeTab = useCardActiveTab(hostKey, 'charts');
  const highlightIndex = useCardHighlightIndex(hostKey);
  const highlightedSectionId = useCardHighlightedSection(hostKey);
  const { stop, toolActive: creationMode, leaveTool } = useMapSheetStop(hostKey);

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The tool's bar sits over the map's foot while the sheet is away.
  const coveredBottom = creationMode
    ? 0
    : mapSheetCoveredHeight(
        Platform.OS,
        Platform.Version,
        { width, height, topInset: insets.top, bottomInset: insets.bottom },
        stop
      );

  // The overlays the Sections and Routes tabs draw, from the same read the card's tabs list.
  const isRouteMatchingOn = useRouteSettings((s) => s.settings.enabled);
  const { createSection, sections: customMatchedSections } = useCustomSections({
    preComputedSections: detail?.customSections ?? NO_CUSTOM_SECTIONS,
  });
  const preComputedMatches = useMemo(
    () => ({ sections: detail?.matchedSections ?? [], sectionCount: detail?.sectionCount ?? 0 }),
    [detail]
  );
  const preComputedOverlays = useMemo(
    () => ({
      sectionTraces: detail?.sectionTraces ?? {},
      prSectionIds: detail?.prSectionIds ?? new Set<string>(),
    }),
    [detail]
  );
  const { sections: engineSectionMatches } = useSectionMatches(id, preComputedMatches);
  const encounters = useMemo(() => detail?.encounters ?? [], [detail]);
  const { sectionOverlays } = useSectionOverlays(
    id,
    engineSectionMatches,
    customMatchedSections,
    coordinates,
    preComputedOverlays,
    encounters
  );
  const rowLabels = useMemo(
    () => sectionRowLabels(groupSectionEncounters(encounters)),
    [encounters]
  );
  const routeOverlay = useMemo(() => routeOverlayLine(detail, activeTab), [detail, activeTab]);
  const visibleSectionOverlays =
    isRouteMatchingOn && (activeTab === 'sections' || activeTab === 'charts')
      ? sectionOverlays
      : null;

  // A marker tap opens the Sections tab of the card on show on that section's row.
  const cardIndex = Math.max(0, useHostCardCount(hostKey) - 1);
  const handleSectionMarkerPress = useCallback(
    (sectionId: string) => activityCardWriter(hostKey, cardIndex).showSection(sectionId),
    [hostKey, cardIndex]
  );

  // The athlete's 3D mode, style and camera angle are written as this activity's override.
  const { getTerrain3DMode, getActivityCamera } = useMapPreferences();
  const { on3DModeChange, onStyleChange, onCameraCapture, undoCameraCapture } =
    useActivityMapChoices(activity?.id);
  const handleCameraCapture = useCallback(
    (camera: TerrainCamera) => {
      if (!activity?.id) return;
      onCameraCapture(camera);
      showNotice({
        message: t('activityDetail.feedPreviewUpdated'),
        action: { label: t('common.undo'), onPress: undoCameraCapture },
      });
    },
    [activity?.id, onCameraCapture, undoCameraCapture, t]
  );
  const terrain3DMode = activity?.sportType
    ? getTerrain3DMode(toActivityType(activity.sportType), activity.id)
    : 'off';
  const saved3DCamera = useMemo(() => {
    if (!activity?.id || terrain3DMode === 'off') return null;
    const verdict = resolveTerrain3D({
      mode: terrain3DMode,
      coordinates: coordinates.map((c): [number, number] => [c.longitude, c.latitude]),
      altitude: streams?.altitude,
      gain: activity.elevationGain,
      distance: activity.distance,
      override: getActivityCamera(activity.id) ?? null,
    });
    return verdict.show3D ? verdict.camera : null;
  }, [activity, terrain3DMode, coordinates, streams, getActivityCamera]);

  // The tool's progress belongs to the map; the tool itself is the stop store's.
  const [creationState, setCreationState] = useState<CreationState | undefined>(undefined);
  const [creationError, setCreationError] = useState<SectionCreationError | null>(null);
  // However the tool ends, its progress goes with it, so the next one starts clean.
  const [toolWasOn, setToolWasOn] = useState(creationMode);
  if (toolWasOn !== creationMode) {
    setToolWasOn(creationMode);
    if (!creationMode) {
      setCreationState(undefined);
      setCreationError(null);
    }
  }
  const endTool = useCallback(
    (mode: boolean) => {
      if (!mode) leaveTool();
    },
    [leaveTool]
  );
  const handleSectionCreated = useCallback(
    (result: SectionCreationResult) =>
      submitSectionCreation({
        result,
        activity: activity ?? undefined,
        createSection,
        translate: (key) => t(key),
        setMode: endTool,
        setState: setCreationState,
        setError: setCreationError,
      }),
    [activity, createSection, t, endTool]
  );
  const handleCreationCancelled = useCallback(() => leaveTool(), [leaveTool]);
  const handleCreationErrorDismiss = useCallback(() => {
    setCreationState(undefined);
    setCreationError(null);
  }, []);

  return (
    <View
      testID="activity-detail-map"
      style={styles.fill}
      pointerEvents={inSlot ? 'box-none' : 'auto'}
    >
      {activity && coordinates.length > 0 ? (
        <ComponentErrorBoundary part="activityMap" debugName="Activity Map">
          <ActivityMapView
            coordinates={coordinates}
            hasStoredTrack={detail?.hasGpsTrack ?? false}
            activityType={toActivityType(activity.sportType)}
            activityId={activity.id}
            streams={streams}
            height={height}
            coveredBottom={coveredBottom}
            showStyleToggle={!creationMode}
            showAttribution
            highlightIndex={highlightIndex}
            on3DModeChange={on3DModeChange}
            onStyleChange={onStyleChange}
            onCameraCapture={handleCameraCapture}
            initial3DCamera={saved3DCamera}
            creationMode={creationMode}
            creationState={creationState}
            creationError={creationError}
            onSectionCreated={handleSectionCreated}
            onCreationCancelled={handleCreationCancelled}
            onCreationErrorDismiss={handleCreationErrorDismiss}
            routeOverlay={routeOverlay}
            sectionOverlays={visibleSectionOverlays}
            sectionRowLabels={rowLabels}
            activeTab={activeTab}
            highlightedSectionId={activeTab === 'sections' ? highlightedSectionId : null}
            onSectionMarkerPress={isRouteMatchingOn ? handleSectionMarkerPress : undefined}
          />
        </ComponentErrorBoundary>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});

/**
 * A section's map filling its host's map screen, under the sheet that holds the section's card.
 * It reads the section from the engine as the card does, and what the card picked (the attempt,
 * the sport on show, the line the delta plot colours, the direction the chart is on) from the
 * host's entry. The section is fitted to the part of the map the header and the sheet's settled
 * stop leave visible.
 *
 * Editing the bounds is a tool on the map. The card enters it through the stop store, which puts
 * the sheet away; the map then draws the handles and the tool's bar over its foot, and Cancel,
 * Save or back ends the tool and presents the sheet again at the stop it had.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SectionMapView } from './SectionMapView';
import { SectionTrimOverlay, SectionTrimToolBar } from './SectionTrimOverlay';
import { useSectionDetailData } from '../hooks/useSectionDetailData';
import { useSectionDataRefresh } from '../hooks/useSectionDataRefresh';
import { useSectionLedger } from '../hooks/useSectionLedger';
import { useSectionTrim } from '../hooks/useSectionTrim';
import { useRouteSettings } from '../stores/RouteSettingsStore';
import {
  useCardAttempt,
  useCardDeltaLine,
  useCardShownDirection,
  useCardSport,
} from '../lib/detailCardState';
import { mapSheetHostKey } from '@/shared/app/mapSheetHost';
import { useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { mapSheetCoveredHeight, useMapSheetStop } from '@/shared/app/mapSheetStop';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
import { Shimmer, SkeletonGroup } from '@/shared/ui';
import { useHeroHeaderBottom } from '@/shared/ui/useHeroHeaderBottom';

/** The header while a tool runs: the tool's bar is the one way out, so the overflow menu goes. */
const TOOL_HEADER = { headerRight: () => null };

interface SectionDetailMapProps {
  /** The section's id. */
  sectionId: string;
  /** The activity the page was opened from, the only one the map key calls "This activity". */
  pageActivityId?: string | undefined;
  /** A stored version History asked to show, drawn as a shadow behind the section. */
  previewVersion?: string | undefined;
}

export function SectionDetailMap({
  sectionId,
  pageActivityId,
  previewVersion,
}: SectionDetailMapProps) {
  const hostKey = mapSheetHostKey('section', sectionId);
  const matchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  const { data: detail, allActivityTraces } = useSectionDetailData(
    matchingEnabled ? sectionId : undefined,
    refreshTick
  );
  const { section } = useSectionDataRefresh(detail?.section);

  const attempt = useCardAttempt(hostKey);
  const sport = useCardSport(hostKey);
  const deltaLine = useCardDeltaLine(hostKey);
  const shownDirection = useCardShownDirection(hostKey);
  const { stop, toolActive, leaveTool } = useMapSheetStop(hostKey);

  // The map mounts once the host's push has finished, so the push is not held by it.
  const [mapReady, setMapReady] = useState(false);
  useAfterNavigationTransition(
    useCallback(() => setMapReady(true), []),
    true
  );

  // A version History asked to show is drawn as a shadow behind the section.
  const bundledLedger = useMemo(
    () =>
      detail
        ? {
            history: detail.history,
            geometryVersions: detail.geometryVersions,
            pinnedVersion: detail.pinnedVersion,
          }
        : undefined,
    [detail]
  );
  const ledger = useSectionLedger(sectionId, bundledLedger);
  const previewNumber = Number(previewVersion);
  const shownVersion = previewVersion && Number.isInteger(previewNumber) ? previewNumber : null;
  const shadowTrack = useMemo<[number, number][] | undefined>(() => {
    if (shownVersion == null) return undefined;
    return ledger.versionPolyline(shownVersion).map((p) => [p.lat, p.lng]);
  }, [shownVersion, ledger]);

  const trim = useSectionTrim(section, refresh, detail?.hasOriginalBounds ?? false);
  const { isTrimming, startTrim } = trim;

  // The tool runs while the stop store says so: entering it starts the edit, and the edit ending,
  // by Cancel, Save or back, ends the tool. A section with no line to edit ends it at once, so the
  // sheet is never left away with nothing over the map.
  const editing = useRef(false);
  const canEdit = !!section?.polyline?.length;
  useEffect(() => {
    if (!toolActive) {
      editing.current = false;
      return;
    }
    if (isTrimming) {
      editing.current = true;
      return;
    }
    if (editing.current || !canEdit) {
      editing.current = false;
      leaveTool();
      return;
    }
    startTrim();
  }, [toolActive, isTrimming, canEdit, startTrim, leaveTool]);

  useMapSheetHostHeader(isTrimming ? TOOL_HEADER : null);

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerBottom = useHeroHeaderBottom();
  const [toolBarHeight, setToolBarHeight] = useState(0);
  const onToolBarLayout = useCallback(
    (event: LayoutChangeEvent) => setToolBarHeight(event.nativeEvent.layout.height),
    []
  );
  const coveredBottom = isTrimming
    ? toolBarHeight
    : mapSheetCoveredHeight(
        Platform.OS,
        Platform.Version,
        { width, height, topInset: insets.top, bottomInset: insets.bottom },
        stop
      );

  const trimPointCount = trim.effectivePointCount || section?.polyline?.length || 0;
  const trimRange = useMemo(
    () => (isTrimming ? { start: trim.trimStart, end: trim.trimEnd } : null),
    [isTrimming, trim.trimStart, trim.trimEnd]
  );

  return (
    <View testID="section-detail-map" style={styles.fill}>
      {section && mapReady ? (
        <SectionMapView
          section={section}
          sportType={sport}
          height={height}
          interactive
          shadowTrack={shadowTrack}
          highlightedActivityId={attempt.activityId}
          highlightedLapPoints={attempt.lapPoints}
          highlightedActivityDate={attempt.date}
          pageActivityId={pageActivityId}
          deltaLine={deltaLine}
          shownDirection={shownDirection}
          allActivityTraces={allActivityTraces}
          trimRange={trimRange}
          extensionTrack={isTrimming && trim.isExpanded ? trim.expandContextPoints : null}
          headerBottom={headerBottom}
          coveredBottom={coveredBottom}
        />
      ) : (
        <SkeletonGroup testID="section-map-skeleton" style={styles.fill}>
          <Shimmer width="100%" height={height} borderRadius={0} />
        </SkeletonGroup>
      )}
      {isTrimming ? (
        <SectionTrimToolBar
          pointCount={trimPointCount}
          startIndex={trim.trimStart}
          endIndex={trim.trimEnd}
          isExpandMode={trim.isExpanded}
          sectionStartInWindow={trim.sectionStartInWindow}
          sectionEndInWindow={trim.sectionEndInWindow}
          trimmedDistance={trim.trimmedDistance}
          isSaving={trim.isSaving}
          canReset={trim.canReset}
          onConfirm={trim.confirmTrim}
          onCancel={trim.cancelTrim}
          onReset={trim.resetBounds}
          bottomInset={insets.bottom}
          onLayout={onToolBarLayout}
        >
          <SectionTrimOverlay
            pointCount={trimPointCount}
            startIndex={trim.trimStart}
            endIndex={trim.trimEnd}
            isSaving={trim.isSaving}
            isExpandMode={trim.isExpanded}
            sectionStartInWindow={trim.sectionStartInWindow}
            sectionEndInWindow={trim.sectionEndInWindow}
            onStartChange={trim.setTrimStart}
            onEndChange={trim.setTrimEnd}
            onToggleExpand={trim.toggleExpand}
          />
        </SectionTrimToolBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});

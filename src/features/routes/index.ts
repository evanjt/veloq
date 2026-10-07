/**
 * What other features import from routes. A cross-feature import comes through
 * here, never a deep path, and `scripts/lint-feature-imports.mjs` holds the
 * deep count where it stands. A name sits on its sub-barrel's line when the
 * sub-barrel exports it, so a suite that mocks the sub-barrel still reaches
 * every importer.
 */
export {
  DataRangeFooter,
  DateRangeSummary,
  DebugInfoPanel,
  DebugWarningBanner,
  DetailFallback,
  GroupingParamPanel,
  GroupingPreviewMap,
  type GroupingRoute,
  PreviewCentrePicker,
  PreviewDiffStrip,
  PreviewMapView,
  PreviewParamPanel,
  PreviewRunCost,
  PreviewSectionPopover,
  RouteDetailChart,
  RouteDetailDebugPanel,
  RouteDetailMap,
  routeDetailScreenStyles,
  RoutePerformanceSection,
  RoutesList,
  SectionsList,
  SectionTrimOverlay,
  SportTypeSelector,
  SyncDebugTab,
  TodayBanner,
} from './components';
export { type RoutesSortOption } from './components/RoutesList';
export {
  MergeCandidatesModal,
  MergeConfirmDialog,
  SectionActionRow,
  SectionContentArea,
  SectionDebugPanel,
  SectionDetailLinks,
  sectionDetailStyles,
  SectionHeader,
  SectionHistoryPanel,
  SectionLapList,
  type SectionStreamsState,
} from './components/section';
export { SectionSparkline } from './components/section/SectionSparkline';
export { type SectionsSortOption } from './components/SectionsList';
export { RANGE_DAYS, type SectionTimeRange } from './constants';
export {
  isElevationHold,
  type MapSection,
  type SectionPerformanceRecord,
  useCustomSections,
  useCutoverHeld,
  useDetectionHold,
  useExcludedActivities,
  useLedgerActivityNames,
  useRevealMapOnDraw,
  useRouteChartData,
  useRouteGroupingPreview,
  useRouteGroups,
  useRouteHighlight,
  useRouteMatch,
  useRoutePerformances,
  useRouteReference,
  useRouteRenaming,
  useRoutesScreenData,
  useSectionActions,
  useSectionActivityData,
  useSectionChartData,
  useSectionChartDataEnriched,
  useSectionDataRefresh,
  useSectionMapData,
  useSectionMatches,
  useSectionPerformances,
  useSectionRescan,
  useSectionUIState,
  useSportTypeFilter,
} from './hooks';
export { useActivityRematch } from './hooks/useActivityRematch';
export { useCutoverSummary, type CutoverSummary } from './hooks/useCutoverSummary';
export { useElevationBackfill } from './hooks/useElevationBackfill';
export { useRepresentativeRoute, useSectionSummaries } from './hooks/useEngine';
export { useMergeSections } from './hooks/useMergeSections';
export { type NamedCorridor, useNamedCorridors } from './hooks/useNamedCorridors';
export { usePreviewCentres } from './hooks/usePreviewCentres';
export { usePreviewCurrentSections } from './hooks/usePreviewCurrentSections';
export { usePreviewDetect } from './hooks/usePreviewDetect';
export { useRouteDetailData } from './hooks/useRouteDetailData';
export { useRouteReoptimization } from './hooks/useRouteReoptimization';
export { useSectionDetailData, useSectionDetailPerformance } from './hooks/useSectionDetailData';
export { useSectionDisplayNames } from './hooks/useSectionDisplayNames';
export { hasPartialExclusion, useSectionLaps } from './hooks/useSectionLaps';
export { useSectionLedger } from './hooks/useSectionLedger';
export { type SectionMatch } from './hooks/useSectionMatches';
export {
  EMPTY_PERFORMANCE_VIEW,
  toPerformanceRecord,
  toPerformanceView,
  useSectionTimeStreamSync,
} from './hooks/useSectionPerformances';
export { useSectionTrim } from './hooks/useSectionTrim';
export { buildFinalRouteGroup, buildRouteGroupBase } from './lib/buildRouteGroup';
export { getPhaseDisplayName } from './lib/detectionProgress';
export { type GroupingParams, groupingParamsOf, paintPreview } from './lib/groupingParams';
export { previewNewNumber } from './lib/previewNewNumber';
export { previewRefusalKey } from './lib/previewRefusal';
export { rescanRefusalKey } from './lib/rescanRefusal';
export { routeHeadline } from './lib/routeHeadline';
export {
  DEFAULT_SECTION_HIDE_FLAGS,
  groupSortFor,
  sectionCountsOf,
  sectionFiltersFor,
  type SectionHideFlags,
  sectionSortFor,
} from './lib/routesScreenQuery';
export { getAllSectionDisplayNames } from './lib/sectionDisplayNames';
export { FIXED_LABEL_LEDGER_KINDS, ledgerDate } from './lib/sectionLedger';
export { isSportOffered, shouldShowSportChips } from './lib/sectionSport';
export { loadTrackFetchNotice } from './lib/trackFetchNotice';
export { useEngineStatus } from './stores/EngineStatusStore';
export {
  initializeRouteSettings,
  isRouteMatchingEnabled,
  useRouteSettings,
} from './stores/RouteSettingsStore';
export { toActivityType } from './types';
export type { SectionDeltaLine } from './lib/deltaLayout';

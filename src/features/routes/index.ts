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
  RouteDetailDebugPanel,
  DetailMapHost,
  RouteDetailMap,
  SectionDetailMap,
  routeDetailScreenStyles,
  RoutePerformanceSection,
  RoutesList,
  SectionsList,
  SectionSwipeAction,
  sectionSwipeAction,
  sectionSwipeKind,
  type SectionSwipeKind,
  SectionTrimOverlay,
  SectionTrimToolBar,
  SportTypeSelector,
  SyncDebugSection,
  TodayBanner,
} from './components';
export { type RoutesSortOption } from './components/RoutesList';
export {
  SectionOverflowMenu,
  SectionContentArea,
  SectionDebugPanel,
  SectionDetailLinks,
  sectionDetailStyles,
  SectionEfficiencyCard,
  SectionHeader,
  sectionHeroName,
  SectionHistoryPanel,
  SectionLapList,
  SectionPerformanceSection,
  sectionStreamsState,
  SectionStreamsNotice,
} from './components/section';
export { SectionSparkline } from './components/section/SectionSparkline';
export { type SectionsSortOption } from './components/SectionsList';
export { RANGE_DAYS, type SectionTimeRange } from './constants';
export {
  isElevationHold,
  type SectionPerformanceRecord,
  useCustomSections,
  useCutoverHeld,
  useDetectionHold,
  useExcludedActivities,
  useLedgerActivityNames,
  useRouteGroupingPreview,
  useRouteMapSignatures,
  useRouteGroups,
  useRouteMatch,
  useRoutePerformances,
  useRouteReference,
  useRouteRenaming,
  useRoutesScreenData,
  useSectionActions,
  useSectionChartData,
  useSectionChartDataEnriched,
  useSectionDataRefresh,
  useSectionMatches,
  useSectionMergeFlow,
  useSectionPerformances,
  useSectionRescan,
  useSectionUIState,
} from './hooks';
export { useActivityRematch } from './hooks/useActivityRematch';
export { useCutoverSummary, type CutoverSummary } from './hooks/useCutoverSummary';
export { useElevationBackfill } from './hooks/useElevationBackfill';
export { useGroupSummaries, useRepresentativeRoute, useSectionSummaries } from './hooks/useEngine';
export { useMergeSections } from './hooks/useMergeSections';
export { type NamedCorridor, useNamedCorridors } from './hooks/useNamedCorridors';
export { usePreviewCentres } from './hooks/usePreviewCentres';
export { usePreviewCurrentSections } from './hooks/usePreviewCurrentSections';
export { usePreviewDetect } from './hooks/usePreviewDetect';
export { useRouteDetailData } from './hooks/useRouteDetailData';
export { DetailCardStack } from './screens/DetailCardStack';
export { RouteDetailCard } from './screens/RouteDetailCard';
export { SectionDetailCard } from './screens/SectionDetailCard';
export { SectionHistoryCard } from './screens/SectionHistoryCard';
export { SectionLapsCard } from './screens/SectionLapsCard';
export { useRouteReoptimisation } from './hooks/useRouteReoptimisation';
export {
  useSectionDetailData,
  useSectionDetailPerformance,
  useRouteDetailPerformance,
} from './hooks/useSectionDetailData';
export { useSectionDisplayNames } from './hooks/useSectionDisplayNames';
export { hasPartialExclusion, useSectionLaps } from './hooks/useSectionLaps';
export { useSectionLedger } from './hooks/useSectionLedger';
export { type SectionMatch } from './hooks/useSectionMatches';
export {
  EMPTY_PERFORMANCE_VIEW,
  toPerformanceRecord,
  toPerformanceView,
  useSectionTimeStreamSync,
  withoutRecordMarks,
} from './hooks/useSectionPerformances';
export { useSectionTrim } from './hooks/useSectionTrim';
export { buildFinalRouteGroup, buildRouteGroupBase } from './lib/buildRouteGroup';
export { getPhaseDisplayKey } from './lib/detectionProgress';
export {
  DETECTION_PARAM_RANGES,
  isPastClamp,
  isPastTestedRange,
  parseParamInput,
} from './lib/detectionParams';
export {
  GROUPING_PARAM_RANGES,
  isPastGroupingRange,
  parseGroupingInput,
} from './lib/groupingParams';
export { fromEditorValue, toEditorText } from './lib/paramUnits';
export type { ParamEditorSheetInput } from './lib/paramEditorSheet';
export type {
  MergeCandidatesSheetInput,
  MergeConfirmSheetInput,
  MergeConfirmSheetResult,
  MergeSectionInfo,
} from './lib/mergeSheets';
export { type GroupingParams, groupingParamsOf, paintPreview } from './lib/groupingParams';
export { previewNewNumber } from './lib/previewNewNumber';
export { previewRefusalKey } from './lib/previewRefusal';
export { ROW_PREVIEW_HEIGHT, ROW_PREVIEW_WIDTH } from './lib/rowLayout';
export { informSectionWriteRefused } from './lib/sectionWriteRefusal';
export { removeSectionWithUndo, restoreSection } from './lib/sectionVisibility';
export { rescanRefusalKey } from './lib/rescanRefusal';
export { routeHeadline } from './lib/routeHeadline';
export { elevationStat, sectionGradeStats, scopeLabels } from './lib/heroStats';
export { directionColour } from './lib/directionColour';
export { PLOT_LABEL_KEYS } from './lib/performancePanel';
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
  initialiseRouteSettings,
  isRouteMatchingEnabled,
  useRouteSettings,
} from './stores/RouteSettingsStore';
export { toActivityType } from './types';
export type { SectionDeltaLine } from './lib/deltaLayout';
export type { ChartDirection } from './lib/scatterData';

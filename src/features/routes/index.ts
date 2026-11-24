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
  GroupingParamPanel,
  GroupingPreviewMap,
  type GroupingRoute,
  PreviewCentrePicker,
  PreviewDiffStrip,
  PreviewMapView,
  PreviewParamPanel,
  PreviewRunCost,
  PreviewSheet,
  PreviewSectionPopover,
  RetiredPairCard,
  type RetiredLayerProps,
  DetailMapHost,
  SectionMapView,
  RoutePerformanceSection,
  RoutesList,
  SectionsList,
  SectionSwipeAction,
  sectionSwipeAction,
  sectionSwipeKind,
  SyncDebugSection,
  TodayBanner,
} from './components';
export { type RoutesSortOption } from './components/RoutesList';
export { SectionSparkline } from './components/section/SectionSparkline';
export { type SectionsSortOption } from './components/SectionsList';
export {
  isElevationHold,
  type SectionPerformanceRecord,
  useCustomSections,
  useCutoverHeld,
  useDetectionHold,
  useRouteGroupingPreview,
  useRouteGroups,
  useRouteMatch,
  useArchivedRetiredCount,
  useRetiredMapData,
  useRetiredSectionCount,
  useRoutesScreenData,
  useSectionMatches,
  useSectionPerformances,
  useSectionRescan,
} from './hooks';
export { useCutoverSummary, type CutoverSummary } from './hooks/useCutoverSummary';
export { useElevationBackfill } from './hooks/useElevationBackfill';
export { useGroupSummaries, useSectionSummaries } from './hooks/useEngine';
export { useMergeSections } from './hooks/useMergeSections';
export { type NamedCorridor, useNamedCorridors } from './hooks/useNamedCorridors';
export { usePreviewCentres } from './hooks/usePreviewCentres';
export { usePreviewCurrentSections } from './hooks/usePreviewCurrentSections';
export { usePreviewDetect } from './hooks/usePreviewDetect';
export { DetailCardStack } from './screens/DetailCardStack';
export { SectionHistoryCard } from './screens/SectionHistoryCard';
export { SectionLapsCard } from './screens/SectionLapsCard';
export { useRouteReoptimisation } from './hooks/useRouteReoptimisation';
export { useRouteSettingsFollowsEngine } from './hooks/useRouteSettingsFollowsEngine';
export { useSectionDisplayNames } from './hooks/useSectionDisplayNames';
export { useSectionLedger } from './hooks/useSectionLedger';
export { type SectionMatch } from './hooks/useSectionMatches';
export { getPhaseDisplayKey } from './lib/detectionProgress';
export { routesBannerOf } from './lib/routesBanner';
export { CUTOVER_FAILURE_KEYS } from './lib/cutoverPhaseKeys';
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
export {
  type GroupingParams,
  type GroupingPreviewDiff,
  groupingParamsOf,
  paintPreview,
} from './lib/groupingParams';
export { scopeGroupingDiff } from './lib/groupingAreaScope';
export { previewNewNumber } from './lib/previewNewNumber';
export { previewAreaBounds } from './lib/previewMapCamera';
export {
  buildRetiredLines,
  centreHoldingRetired,
  describeRetiredSelection,
} from './lib/retiredLineCollection';
export { previewRefusalKey } from './lib/previewRefusal';
export { ROW_PREVIEW_HEIGHT, ROW_PREVIEW_WIDTH } from './lib/rowLayout';
export { preferSectionWithUndo, removeSectionWithUndo } from './lib/sectionVisibility';
export { rescanRefusalKey } from './lib/rescanRefusal';
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
export { ledgerDate } from './lib/sectionLedger';
export { changeCopy } from './lib/sectionChangeCopy';
export { loadTrackFetchNotice } from './lib/trackFetchNotice';
export { useEngineStatus } from './stores/EngineStatusStore';
export {
  initialiseRouteSettings,
  isRouteMatchingEnabled,
  useRouteSettings,
} from './stores/RouteSettingsStore';
export type { SectionDeltaLine } from './lib/deltaLayout';

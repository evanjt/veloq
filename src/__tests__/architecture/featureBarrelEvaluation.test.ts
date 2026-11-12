/**
 * Scenario: a feature barrel re-exports every module the outside tree takes
 * from it, so importing the barrel evaluates all of them in source order. Two
 * of those modules reach another feature's barrel, which reaches back here, and
 * a module that is part-way through evaluation hands out an exports object
 * whose later bindings are still undefined.
 *
 * Expected behaviour: whichever barrel the app happens to load first, every
 * name the other one publishes is defined by the time the import returns. The
 * two orders are separate cases because a cycle only bites the entry point that
 * starts it.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const ACTIVITY_NAMES = [
  'ActivityCard',
  'ActivityCardContextMenu',
  'ActivityChartsSection',
  'ActivityRoutesSection',
  'ActivitySectionsSection',
  'SkylineBar',
  'fixtures',
  'useActivity',
  'useActivityBoundsCache',
  'useActivityIntervals',
  'useActivitySectionHighlights',
  'useActivityStreams',
  'useDetailCoordinates',
  'useInfiniteActivities',
  'useFeedSearch',
  'useSectionOverlays',
  'useActivityDetailData',
  'FEED_GROUPS',
  'groupSectionEncounters',
  'setVisibleRange',
];

/** The helpers this feature used to publish, now shared, kept here so the move
 *  cannot quietly come back and close the cycle again. */
const SHARED_HELPERS = [
  'getActivityColor',
  'getActivityIcon',
  'isPaceSport',
  'isSwimmingActivity',
  'measuresPower',
  'sortByDateId',
];

function undefinedNames(mod: Record<string, unknown>, names: string[]): string[] {
  return names.filter((name) => mod[name] === undefined);
}

/** Every value the outside tree takes from routes. The barrel loads every
 *  component, hook and store behind them, and several of those reach the maps,
 *  activity, home and insights barrels, which import routes back. */
const ROUTES_NAMES = [
  'buildFinalRouteGroup',
  'buildRouteGroupBase',
  'DataRangeFooter',
  'DateRangeSummary',
  'DebugInfoPanel',
  'DebugWarningBanner',
  'DEFAULT_SECTION_HIDE_FLAGS',
  'DetailFallback',
  'EMPTY_PERFORMANCE_VIEW',
  'FIXED_LABEL_LEDGER_KINDS',
  'getAllSectionDisplayNames',
  'getPhaseDisplayKey',
  'GroupingParamPanel',
  'groupingParamsOf',
  'GroupingPreviewMap',
  'groupSortFor',
  'hasPartialExclusion',
  'initialiseRouteSettings',
  'isElevationHold',
  'isRouteMatchingEnabled',
  'isSportOffered',
  'ledgerDate',
  'loadTrackFetchNotice',
  'paintPreview',
  'PreviewCentrePicker',
  'PreviewDiffStrip',
  'PreviewMapView',
  'previewNewNumber',
  'PreviewParamPanel',
  'previewRefusalKey',
  'PreviewRunCost',
  'PreviewSectionPopover',
  'RANGE_DAYS',
  'rescanRefusalKey',
  'RouteDetailDebugPanel',
  'RouteDetailMap',
  'routeDetailScreenStyles',
  'routeHeadline',
  'RoutePerformanceSection',
  'RoutesList',
  'SectionContentArea',
  'SectionDebugPanel',
  'SectionDetailCard',
  'SectionDetailMap',
  'sectionDetailStyles',
  'sectionFiltersFor',
  'SectionHeader',
  'SectionHistoryPanel',
  'SectionLapList',
  'SectionPerformanceSection',
  'SectionsList',
  'sectionSortFor',
  'SectionSparkline',
  'SectionStreamsNotice',
  'sectionStreamsState',
  'SectionTrimOverlay',
  'SyncDebugSection',
  'toActivityType',
  'TodayBanner',
  'toPerformanceRecord',
  'toPerformanceView',
  'useActivityRematch',
  'useCustomSections',
  'useCutoverHeld',
  'useCutoverSummary',
  'useDetectionHold',
  'useElevationBackfill',
  'useEngineStatus',
  'useExcludedActivities',
  'useLedgerActivityNames',
  'useMergeSections',
  'useNamedCorridors',
  'usePreviewCentres',
  'usePreviewCurrentSections',
  'usePreviewDetect',
  'useRepresentativeRoute',
  'useRouteDetailData',
  'useRouteDetailPerformance',
  'useRouteGroupingPreview',
  'useRouteGroups',
  'useRouteMapSignatures',
  'useRouteMatch',
  'useRoutePerformances',
  'useRouteReference',
  'useRouteRenaming',
  'useRouteReoptimisation',
  'useRouteSettings',
  'useRoutesScreenData',
  'useSectionActions',
  'useSectionChartData',
  'useSectionChartDataEnriched',
  'useSectionDataRefresh',
  'useSectionDetailData',
  'useSectionDetailPerformance',
  'useSectionDisplayNames',
  'useSectionLaps',
  'useSectionLedger',
  'useSectionMatches',
  'useSectionMergeFlow',
  'useSectionPerformances',
  'useSectionRescan',
  'useSectionSummaries',
  'useSectionTimeStreamSync',
  'useSectionTrim',
  'useSectionUIState',
  'withoutRecordMarks',
];

const OTHER_FEATURE_NAMES: [string, string[]][] = [
  ['fitness', ['formatForm', 'formatEffortValue', 'useSportPreference', 'PRIMARY_SPORT_FAMILY']],
  [
    'home',
    [
      'useSummaryCardData',
      'useStartupData',
      'FeedFirstSyncStandby',
      'summaryCardTarget',
      'readPlannedWorkouts',
    ],
  ],
  [
    'insights',
    [
      'buildInsightsParams',
      'readTaskRuns',
      'confidenceFrom',
      'registerBackgroundNotificationTask',
      'isForSignedInAthlete',
    ],
  ],
  ['strength', ['generateStrengthInsights', 'useStrengthScreenData']],
  ['sensors', ['initialiseKnownSensors']],
  [
    'settings',
    [
      'HERO_METRICS',
      'useMapPreferences',
      'useDebugStore',
      'initialiseDebugStore',
      'getNotificationPreferences',
      'initialiseNotificationPreferences',
      'isPrivacyNoticeOwed',
      'useNotificationPrompt',
      'initialiseNotificationPrompt',
      'initialiseWhatsNewStore',
      'onAppForeground',
      'initWebdavConfig',
      'refreshPushTokenRegistration',
      'registerPushToken',
      'withDatabaseSnapshot',
      'useGpxExport',
      'useImportDatabaseBackup',
      'WhatsNewModal',
      'TourReturnPill',
    ],
  ],
  [
    'recording',
    [
      'useRecordingStore',
      'useRecordingLibrary',
      'useRecordingLiveStore',
      'getRecordingMode',
      'recordingFitExists',
      'RecordingReturnPill',
      'RecordingGate',
      'RecordingTitle',
      'useRecordingPreferences',
      'useUploadPermissionStore',
    ],
  ],
];

/** Features whose barrels the app can enter from, besides maps. */
const OTHER_FEATURES = [
  'fitness',
  'home',
  'insights',
  'strength',
  'sensors',
  'settings',
  'routes',
  'activity',
  'recording',
];

const NAMES_BY_FEATURE: Record<string, string[]> = {
  activity: ACTIVITY_NAMES,
  routes: ROUTES_NAMES,
  ...Object.fromEntries(OTHER_FEATURE_NAMES),
};

/** Every (barrel checked, barrel loaded first) case, grouped by the one that
 *  loads first. A cycle bites the entry point that starts it, so each group
 *  loads its entry once into a fresh registry and every barrel checked from
 *  that entry is then read from it, instead of re-evaluating the app graph for
 *  each pair. */
function casesByEntry(): [string, string[]][] {
  const byEntry = new Map<string, string[]>();
  const add = (entry: string, checked: string) =>
    byEntry.set(entry, [...(byEntry.get(entry) ?? []), checked]);
  for (const checked of Object.keys(NAMES_BY_FEATURE)) {
    const entries =
      checked === 'activity'
        ? ['activity', 'routes', 'maps']
        : checked === 'routes'
          ? ['routes', 'maps', ...OTHER_FEATURES.filter((o) => o !== 'routes')]
          : [checked, ...OTHER_FEATURES.filter((o) => o !== checked)];
    for (const entry of entries) add(entry, checked);
  }
  return [...byEntry];
}

describe.each(casesByEntry())('with the %s barrel loaded first', (entry, checked) => {
  beforeAll(() => {
    jest.resetModules();
    require(`@/features/${entry}`);
  });

  it.each(checked)('the %s barrel defines every name it publishes', (feature) => {
    expect(
      undefinedNames(require(`@/features/${feature}`), NAMES_BY_FEATURE[feature])
    ).toStrictEqual([]);
  });
});

describe('the barrels keep the cycle split', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('leaves the shared activity helpers out, which is what splits the cycle', () => {
    const activity = require('@/features/activity');
    const shared = require('@/shared/activity/activityUtils');

    expect(SHARED_HELPERS.filter((name) => activity[name] !== undefined)).toStrictEqual([]);
    expect(SHARED_HELPERS.filter((name) => shared[name] === undefined)).toStrictEqual([]);
  });

  it('stays out of the maps barrel, which routes reads from at module scope', () => {
    jest.doMock('@/features/routes', () => {
      throw new Error('the maps barrel loaded the routes barrel');
    });

    expect(() => require('@/features/maps')).not.toThrow();
  });
});

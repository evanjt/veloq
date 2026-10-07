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
  'ActivityHeader',
  'ActivityRoutesSection',
  'ActivitySectionsSection',
  'SkylineBar',
  'fixtures',
  'getLatestFTP',
  'useActivities',
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
  'useActivityLabels',
  'FEED_GROUPS',
  'groupSectionEncounters',
  'setVisibleRange',
];

/** The helpers this feature used to publish, now shared, kept here so the move
 *  cannot quietly come back and close the cycle again. */
const SHARED_HELPERS = [
  'getActivityColor',
  'getActivityIcon',
  'getSportDisplayName',
  'isPaceSport',
  'isSwimmingActivity',
  'measuresPower',
  'sortByDateId',
  'toActivityMetrics',
];

function undefinedNames(mod: Record<string, unknown>, names: string[]): string[] {
  return names.filter((name) => mod[name] === undefined);
}

describe('the activity barrel evaluates whole, whichever end the app enters from', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('defines every name it publishes when it is the first feature loaded', () => {
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('defines them when a feature that imports it back is loaded first', () => {
    require('@/features/routes');
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('defines them when the maps barrel is loaded first', () => {
    require('@/features/maps');
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('leaves the shared activity helpers out, which is what splits the cycle', () => {
    const activity = require('@/features/activity');
    const shared = {
      ...require('@/shared/activity/activityUtils'),
      ...require('@/shared/activity/activityMetrics'),
    };

    expect(SHARED_HELPERS.filter((name) => activity[name] !== undefined)).toStrictEqual([]);
    expect(SHARED_HELPERS.filter((name) => shared[name] === undefined)).toStrictEqual([]);
  });
});

describe.each([
  [
    'fitness',
    [
      'formatForm',
      'formatEffortValue',
      'currentAndPreviousWeek',
      'useSportPreference',
      'SPORT_TEXT_COLORS',
    ],
  ],
  [
    'home',
    [
      'useSummaryCardData',
      'useStartupData',
      'FeedFirstSyncStandby',
      'HERO_METRICS',
      'readCalendarEvents',
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
  ['sensors', ['initializeKnownSensors']],
  [
    'settings',
    [
      'useDebugStore',
      'initializeDebugStore',
      'getNotificationPreferences',
      'initializeNotificationPreferences',
      'isPrivacyNoticeOwed',
      'useNotificationPrompt',
      'initializeNotificationPrompt',
      'initializeWhatsNewStore',
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
      'ACTIVITY_CATEGORIES',
    ],
  ],
])('the %s barrel evaluates whole', (feature, names) => {
  const others = [
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

  beforeEach(() => {
    jest.resetModules();
  });

  it('defines every name it publishes when it is the first feature loaded', () => {
    expect(undefinedNames(require(`@/features/${feature}`), names)).toStrictEqual([]);
  });

  it.each(others.filter((o) => o !== feature))('defines them when %s is loaded first', (first) => {
    require(`@/features/${first}`);
    expect(undefinedNames(require(`@/features/${feature}`), names)).toStrictEqual([]);
  });
});

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
  'getPhaseDisplayName',
  'GroupingParamPanel',
  'groupingParamsOf',
  'GroupingPreviewMap',
  'groupSortFor',
  'hasPartialExclusion',
  'initializeRouteSettings',
  'isElevationHold',
  'isRouteMatchingEnabled',
  'isSportOffered',
  'ledgerDate',
  'loadTrackFetchNotice',
  'MergeCandidatesModal',
  'MergeConfirmDialog',
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
  'RouteDetailChart',
  'RouteDetailDebugPanel',
  'RouteDetailMap',
  'routeDetailScreenStyles',
  'routeHeadline',
  'RoutePerformanceSection',
  'RoutesList',
  'SectionActionRow',
  'SectionContentArea',
  'SectionDebugPanel',
  'sectionDetailStyles',
  'sectionFiltersFor',
  'SectionHeader',
  'SectionHistoryPanel',
  'SectionLapList',
  'SectionsList',
  'sectionSortFor',
  'SectionSparkline',
  'SectionTrimOverlay',
  'shouldShowSportChips',
  'SportTypeSelector',
  'SyncDebugTab',
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
  'useRevealMapOnDraw',
  'useRouteChartData',
  'useRouteDetailData',
  'useRouteGroupingPreview',
  'useRouteGroups',
  'useRouteHighlight',
  'useRouteMatch',
  'useRoutePerformances',
  'useRouteReference',
  'useRouteRenaming',
  'useRouteReoptimization',
  'useRouteSettings',
  'useRoutesScreenData',
  'useSectionActions',
  'useSectionActivityData',
  'useSectionChartData',
  'useSectionChartDataEnriched',
  'useSectionDataRefresh',
  'useSectionDetailData',
  'useSectionDetailPerformance',
  'useSectionDisplayNames',
  'useSectionLaps',
  'useSectionLedger',
  'useSectionMapData',
  'useSectionMatches',
  'useSectionPerformances',
  'useSectionRescan',
  'useSectionSummaries',
  'useSectionTimeStreamSync',
  'useSectionTrim',
  'useSectionUIState',
  'useSportTypeFilter',
];

describe('the routes barrel evaluates whole, whichever end the app enters from', () => {
  const others = [
    'maps',
    'activity',
    'fitness',
    'home',
    'insights',
    'strength',
    'sensors',
    'settings',
    'recording',
  ];

  beforeEach(() => {
    jest.resetModules();
  });

  it('defines every name it publishes when it is the first feature loaded', () => {
    expect(undefinedNames(require('@/features/routes'), ROUTES_NAMES)).toStrictEqual([]);
  });

  it.each(others)('defines them when %s is loaded first', (first) => {
    require(`@/features/${first}`);
    expect(undefinedNames(require('@/features/routes'), ROUTES_NAMES)).toStrictEqual([]);
  });

  it('stays out of the maps barrel, which routes reads from at module scope', () => {
    jest.doMock('@/features/routes', () => {
      throw new Error('the maps barrel loaded the routes barrel');
    });

    expect(() => require('@/features/maps')).not.toThrow();
  });
});

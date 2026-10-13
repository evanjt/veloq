/**
 * Scenario: the section detail screen hands its hooks values it builds from the
 * engine's bundle. Built inline, a fresh object per render defeated their
 * memoisation on every root render, and a rename save renders the root through
 * the optimistic name the actions hook holds.
 *
 * Expected behaviour: a re-render with the same bundle passes the same section,
 * refresh callback and excluded-id list to `useSectionActions` and
 * `useSectionTrim`, the same ledger to `useSectionLedger` and the same id lists
 * to `useSectionTimeStreamSync`, so those hooks' memoisation holds across a
 * rename.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import SectionDetailScreen from '@/app/section/[id]';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// The options each `Stack.Screen` the screen renders hands its navigation item, merged in order.
let mockScreenOptions: Record<string, unknown> = {};
jest.mock('expo-router', () => {
  function Stack() {
    return null;
  }
  Stack.Screen = function Screen({ options }: { options?: Record<string, unknown> }) {
    mockScreenOptions = { ...mockScreenOptions, ...options };
    return null;
  };
  return {
    ...jest.requireActual('expo-router'),
    useIsFocused: () => true,
    useLocalSearchParams: () => ({ id: 'sec-1' }),
    useFocusEffect: () => {},
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
    Stack,
  };
});
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/native/engine', () => ({ isEngineReady: () => true }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/debug/flowTiming', () => ({
  FLOW_SECTION_OPEN: 'section-open',
  completeFlowAfterFrame: () => {},
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => ({}) }),
}));
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => {},
}));
jest.mock('@/shared/ui', () => ({
  Button: () => null,
  ErrorState: () => null,
  useHeroMapHeight: () => 300,
  useBottomClearance: () => 0,
  useScrollEndInset: () => 0,
}));
jest.mock('@/features/settings', () => ({
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
  useDebugStore: (select: (s: { enabled: boolean }) => unknown) => select({ enabled: false }),
}));

const mockSection = {
  id: 'sec-1',
  name: 'Ridge climb',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  activityPortions: [{ activityId: 'a1' }],
  visitCount: 3,
};

// One bundle for the life of the test, as the engine read hands the same one
// back until the section changes.
const mockDetail = {
  section: mockSection,
  activityMetrics: [],
  mapSignatures: [],
  excludedActivityIds: ['a2'],
  history: [],
  geometryVersions: [],
  pinnedVersion: null,
  mergeCandidates: [],
  hasOriginalBounds: false,
  missingTimeStreamIds: [],
  activityCount: 1,
};

const mockUseSectionLedger = jest.fn((..._args: unknown[]) => ({
  pinnedVersion: null,
  history: [],
  versionPolyline: () => [],
}));
const mockUseSectionTimeStreamSync = jest.fn((..._args: unknown[]) => ({
  ready: true,
  error: undefined,
  outstanding: 0,
  refetch: () => {},
}));
const mockUseSectionActions = jest.fn((_options: Record<string, unknown>) => ({}));
const mockUseSectionTrim = jest.fn((..._args: unknown[]) => ({}));

let capturedSaveName: ((name: string) => void) | undefined;
let capturedActivitySelect: ((activityId: string | null) => void) | undefined;
let capturedEfficiencyTrend: unknown;
let capturedContentArea:
  | { streams?: unknown; bestForwardIsRecord?: boolean; bestReverseIsRecord?: boolean }
  | undefined;
let mockSelectedSport: string | undefined;
const mockUseSectionDetailPerformance = jest.fn(
  (..._args: unknown[]): { data: unknown; error: unknown } => ({
    data: undefined,
    error: undefined,
  })
);

jest.mock('@/features/routes', () => {
  const React = require('react');
  const noop = () => {};
  const component = () => null;
  const useRouteSettings = (select: (s: unknown) => unknown) =>
    select({ settings: { enabled: true } });
  useRouteSettings.getState = () => ({ setEnabled: noop });
  return {
    useRouteSettings,
    sectionDetailStyles: new Proxy({}, { get: () => ({}) }),
    RANGE_DAYS: { '3m': 90 },
    EMPTY_PERFORMANCE_VIEW: {
      records: [],
      bestForwardRecord: undefined,
      bestReverseRecord: undefined,
      forwardStats: undefined,
      reverseStats: undefined,
    },
    toPerformanceRecord: (record: unknown) => record,
    toPerformanceView: () => jest.requireMock('@/features/routes').EMPTY_PERFORMANCE_VIEW,
    hasPartialExclusion: () => false,
    isSportOffered: () => true,
    rescanRefusalKey: () => null,
    shouldShowSportChips: () => false,
    sectionStreamsState: jest.requireActual(
      '@/features/routes/components/section/SectionPerformanceSection'
    ).sectionStreamsState,
    useRevealMapOnDraw: noop,
    createMapHighlightStore: jest.requireActual('@/features/routes/lib/mapHighlight')
      .createMapHighlightStore,
    forwardDirectionColour: jest.requireActual('@/features/routes/lib/directionColour')
      .forwardDirectionColour,
    useMergeSections: () => ({ merge: noop, previewDropped: false }),
    useSectionDetailData: () => ({ data: mockDetail, status: 'ready', retirement: undefined }),
    useSectionDetailPerformance: (...args: unknown[]) => mockUseSectionDetailPerformance(...args),
    useSectionTimeStreamSync: (...args: unknown[]) => mockUseSectionTimeStreamSync(...args),
    useSectionChartData: () => ({ chartData: [] }),
    useSectionChartDataEnriched: () => ({ calendarSummary: null, combinedChartData: [] }),
    useSectionLedger: (...args: unknown[]) => mockUseSectionLedger(...args),
    useSectionDataRefresh: (() => {
      const handleTrimRefresh = () => {};
      return () => ({ section: mockSection, sectionRefreshKey: 0, handleTrimRefresh });
    })(),
    useSectionUIState: () => {
      const [mapReady, setMapReady] = React.useState(false);
      return {
        highlightedActivityId: null,
        setHighlightedActivityId: noop,
        highlightedActivityPoints: undefined,
        setHighlightedActivityPoints: noop,
        mapReady,
        setMapReady,
        sectionTimeRange: '3m',
        setSectionTimeRange: noop,
        selectedSportType: mockSelectedSport,
        setSelectedSportType: noop,
      };
    },
    // The optimistic name lives inside this hook, as in the real one, so a
    // save re-renders the screen root through it.
    useSectionActions: (options: Record<string, unknown>) => {
      mockUseSectionActions(options);
      const [customName, setCustomName] = React.useState(null as string | null);
      return { customName, handleSaveName: setCustomName };
    },
    useSectionTrim: (...args: unknown[]) => {
      mockUseSectionTrim(...args);
      return { isTrimming: false };
    },
    DataRangeFooter: component,
    DetailFallback: component,
    SectionTrimOverlay: component,
    SportTypeSelector: component,
    SectionActionRow: component,
    SectionContentArea: (props: {
      onActivitySelect: (activityId: string | null) => void;
      efficiencyTrend?: unknown;
      streams?: unknown;
      bestForwardIsRecord?: boolean;
      bestReverseIsRecord?: boolean;
    }) => {
      capturedActivitySelect = props.onActivitySelect;
      capturedEfficiencyTrend = props.efficiencyTrend;
      capturedContentArea = props;
      return null;
    },
    SectionDebugPanel: component,
    SectionDetailLinks: component,
    useSectionMergeFlow: () => noop,
    sectionHeroName: jest.requireActual('@/features/routes/components/section/SectionHeader')
      .sectionHeroName,
    SectionHeader: (props: { onSaveName: (name: string) => void }) => {
      capturedSaveName = props.onSaveName;
      return null;
    },
  };
});

describe('section detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedSaveName = undefined;
    capturedActivitySelect = undefined;
    capturedEfficiencyTrend = undefined;
    mockSelectedSport = undefined;
    mockScreenOptions = {};
  });

  it("titles its navigation item with the section's name", async () => {
    await render(<SectionDetailScreen />);
    await act(async () => {});
    expect(mockScreenOptions.title).toBe('Ridge climb');
  });

  it('keeps what it hands its hooks stable across a rename', async () => {
    await render(<SectionDetailScreen />);
    await act(async () => {});

    const actionsBefore = mockUseSectionActions.mock.calls.at(-1)?.[0];
    const trimBefore = mockUseSectionTrim.mock.calls.at(-1);
    const ledgerBefore = mockUseSectionLedger.mock.calls.at(-1);
    const streamsBefore = mockUseSectionTimeStreamSync.mock.calls.at(-1);
    expect(actionsBefore?.preComputedExcludedActivityIds).toEqual(['a2']);
    expect(ledgerBefore?.[1]).toEqual({ history: [], geometryVersions: [], pinnedVersion: null });
    expect(streamsBefore?.[0]).toEqual(['a1']);
    const renders = mockUseSectionActions.mock.calls.length;

    await act(async () => {
      capturedSaveName?.('Hill');
    });

    expect(mockUseSectionActions.mock.calls.length).toBeGreaterThan(renders);
    const actionsAfter = mockUseSectionActions.mock.calls.at(-1)?.[0];
    expect(actionsAfter?.section).toBe(actionsBefore?.section);
    expect(actionsAfter?.onSectionRefresh).toBe(actionsBefore?.onSectionRefresh);
    expect(actionsAfter?.preComputedExcludedActivityIds).toBe(
      actionsBefore?.preComputedExcludedActivityIds
    );
    const trimAfter = mockUseSectionTrim.mock.calls.at(-1);
    expect(trimAfter?.[0]).toBe(trimBefore?.[0]);
    expect(trimAfter?.[1]).toBe(trimBefore?.[1]);
    expect(mockUseSectionLedger.mock.calls.at(-1)?.[1]).toBe(ledgerBefore?.[1]);
    expect(mockUseSectionTimeStreamSync.mock.calls.at(-1)?.[0]).toBe(streamsBefore?.[0]);
    expect(mockUseSectionTimeStreamSync.mock.calls.at(-1)?.[1]).toBe(streamsBefore?.[1]);
  });

  it('keeps the chart in place through a scrub and a dot tap', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    try {
      await render(<SectionDetailScreen />);
      await act(async () => {});
      expect(capturedActivitySelect).toBeDefined();
      scrollTo.mockClear();

      await act(async () => {
        for (const id of ['attempt-a', 'attempt-b', 'attempt-c']) {
          capturedActivitySelect?.(id);
        }
      });
      expect(scrollTo).not.toHaveBeenCalled();

      await act(async () => capturedActivitySelect?.('attempt-d'));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollTo.mockRestore();
    }
  });
});

/**
 * Scenario: a section ridden and run, with the Run chip picked.
 *
 * Expected behaviour: the efficiency card is handed the trend the performance
 * read carries for the sport it answered, not one the detail bundle took for
 * the sport with the most outings.
 */
describe('section detail efficiency trend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedEfficiencyTrend = undefined;
  });

  it('hands the content area the performance read trend for the picked sport', async () => {
    mockSelectedSport = 'Run';
    const runTrend = { sportType: 'Run', points: [], effortCount: 3 };
    mockUseSectionDetailPerformance.mockImplementation((...args: unknown[]) => ({
      data: {
        sportType: args[2],
        sportCounts: [
          { sportType: 'Ride', count: 4 },
          { sportType: 'Run', count: 3 },
        ],
        performances: {},
        chartData: { points: [] },
        excludedPoints: [],
        lapRecords: [],
        efficiencyTrend: args[2] === 'Run' ? runTrend : undefined,
      },
      error: undefined,
    }));

    await render(<SectionDetailScreen />);
    await act(async () => {});

    expect(mockUseSectionDetailPerformance.mock.calls.at(-1)?.[2]).toBe('Run');
    expect(capturedEfficiencyTrend).toBe(runTrend);
  });
});

/**
 * Scenario: offline, the wait for the section's time streams ended with two
 * activities still missing, and the performance read named its best the
 * record from the activities it had.
 *
 * Expected behaviour: the content area is told the streams are partial, with
 * the count and a retry, and is handed no record flag in either direction.
 */
describe('section detail with time streams missing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedContentArea = undefined;
    mockSelectedSport = undefined;
  });

  function readNamingRecords() {
    mockUseSectionDetailPerformance.mockImplementation(() => ({
      data: {
        sportType: 'Ride',
        sportCounts: [{ sportType: 'Ride', count: 3 }],
        performances: {},
        chartData: { points: [] },
        excludedPoints: [],
        lapRecords: [],
        bestForwardIsRecord: true,
        bestReverseIsRecord: true,
      },
      error: undefined,
    }));
  }

  it('hands the partial state and holds back the record flags', async () => {
    readNamingRecords();
    const refetch = jest.fn();
    mockUseSectionTimeStreamSync.mockImplementation(() => ({
      ready: true,
      error: undefined,
      outstanding: 2,
      refetch,
    }));

    await render(<SectionDetailScreen />);
    await act(async () => {});

    expect(capturedContentArea?.streams).toEqual({
      status: 'partial',
      outstanding: 2,
      onRetry: refetch,
    });
    expect(capturedContentArea?.bestForwardIsRecord).toBe(false);
    expect(capturedContentArea?.bestReverseIsRecord).toBe(false);
  });

  it('passes the record flags through once every stream is stored', async () => {
    readNamingRecords();
    mockUseSectionTimeStreamSync.mockImplementation(() => ({
      ready: true,
      error: undefined,
      outstanding: 0,
      refetch: () => {},
    }));

    await render(<SectionDetailScreen />);
    await act(async () => {});

    expect((capturedContentArea?.streams as { status: string }).status).toBe('ready');
    expect(capturedContentArea?.bestForwardIsRecord).toBe(true);
  });
});

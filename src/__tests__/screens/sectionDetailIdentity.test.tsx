/**
 * Scenario: the section's card hands its hooks values it builds from the
 * engine's bundle. Built inline, a fresh object per render defeated their
 * memoisation on every render, and a rename save renders the card through
 * the optimistic name the actions hook holds.
 *
 * Expected behaviour: a re-render with the same bundle passes the same section,
 * refresh callback and excluded-id list to `useSectionActions`, the same ledger
 * to `useSectionLedger` and the same id lists to `useSectionTimeStreamSync`, so
 * those hooks' memoisation holds across a rename. A pick in the chart is the
 * card's state in the host's entry, where the map reads it.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { sectionCardInHost } from '../__shared__/sectionCardInHost';
import { topCard, useMapSheetHosts } from '@/shared/app/mapSheetHost';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// The options the card hands its host's navigation item, merged in order.
let mockScreenOptions: Record<string, unknown> = {};
const SectionDetailScreen = sectionCardInHost((options) => {
  mockScreenOptions = { ...mockScreenOptions, ...options };
});
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  useLocalSearchParams: () => ({ id: 'sec-1' }),
  useFocusEffect: () => {},
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/native/engine', () => ({ isEngineReady: () => true }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
const mockCompleteFlowAfterFrame = jest.fn();
jest.mock('@/shared/debug/flowTiming', () => ({
  FLOW_SECTION_OPEN: 'section-open',
  completeFlowAfterFrame: (name: string) => mockCompleteFlowAfterFrame(name),
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
  EmptyState: () => null,
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

function mockRoutes() {
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
    toPerformanceView: () => mockRoutes().EMPTY_PERFORMANCE_VIEW,
    hasPartialExclusion: () => false,
    isSportOffered: () => true,
    rescanRefusalKey: () => null,
    shouldShowSportChips: () => false,
    sectionStreamsState: jest.requireActual(
      '@/features/routes/components/section/SectionPerformanceSection'
    ).sectionStreamsState,
    useSectionDetailData: () => ({ data: mockDetail, status: 'ready', retirement: undefined }),
    useSectionDetailPerformance: (...args: unknown[]) => mockUseSectionDetailPerformance(...args),
    useSectionTimeStreamSync: (...args: unknown[]) => mockUseSectionTimeStreamSync(...args),
    useSectionChartData: () => ({ chartData: [] }),
    useSectionChartDataEnriched: () => ({ calendarSummary: null, combinedChartData: [] }),
    useSectionLedger: (...args: unknown[]) => mockUseSectionLedger(...args),
    useSectionDataRefresh: mockUseSectionDataRefresh,
    useSectionUIState: () => ({
      sectionTimeRange: '3m',
      setSectionTimeRange: noop,
      selectedSportType: mockSelectedSport,
      setSelectedSportType: noop,
    }),
    // The optimistic name lives inside this hook, as in the real one, so a
    // save re-renders the card through it.
    useSectionActions: (options: Record<string, unknown>) => {
      mockUseSectionActions(options);
      const [customName, setCustomName] = React.useState(null as string | null);
      return { customName, handleSaveName: setCustomName };
    },
    DataRangeFooter: component,
    DetailFallback: component,
    SportTypeSelector: component,
    SectionActionRow: component,
    SectionOverflowMenu: component,
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
}

const mockHandleTrimRefresh = () => {};
function mockUseSectionDataRefresh() {
  return { section: mockSection, sectionRefreshKey: 0, handleTrimRefresh: mockHandleTrimRefresh };
}

// The card reads its hooks and parts from their own modules, so each is replaced from one set.
jest.mock('@/features/routes/components', () => mockRoutes());
jest.mock('@/features/routes/components/section', () => mockRoutes());
jest.mock('@/features/routes/stores/RouteSettingsStore', () => mockRoutes());
jest.mock('@/features/routes/hooks', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionActions', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionDetailData', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionDataRefresh', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionUIState', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionMergeFlow', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionLedger', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionPerformances', () => mockRoutes());
jest.mock('@/features/routes/hooks/useSectionLaps', () => mockRoutes());
jest.mock('@/features/routes/lib/sectionSport', () => mockRoutes());
jest.mock('@/features/routes/lib/rescanRefusal', () => mockRoutes());
jest.mock('@/features/routes/constants', () => mockRoutes());

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

  it('writes a pick in the chart to the card it shows in the host, where the map reads it', async () => {
    await render(<SectionDetailScreen />);
    await act(async () => {});

    await act(async () => capturedActivitySelect?.('attempt-e'));

    const card = topCard(useMapSheetHosts.getState().hosts, 'section:sec-1');
    expect(card?.kind).toBe('section');
    expect(card?.state.attemptId).toBe('attempt-e');
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

/**
 * Scenario: a section opens while its time streams are still being checked, so
 * the first frame shows the header and no attempt yet.
 *
 * Expected behaviour: the open is timed to the frame after the performance
 * read answers, the one that draws the visits, and once only however often the
 * screen renders after that.
 */
describe('section detail open timing', () => {
  const performanceRead = {
    data: {
      sportType: 'Ride',
      sportCounts: [{ sportType: 'Ride', count: 3 }],
      performances: {},
      chartData: { points: [] },
      excludedPoints: [],
      lapRecords: [],
    },
    error: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedSport = undefined;
    mockUseSectionTimeStreamSync.mockImplementation(() => ({
      ready: true,
      error: undefined,
      outstanding: 0,
      refetch: () => {},
    }));
  });

  it('completes at the frame the visits are drawn, not at mount', async () => {
    mockUseSectionDetailPerformance.mockImplementation(() => ({
      data: undefined,
      error: undefined,
    }));
    const screen = await render(<SectionDetailScreen />);
    await act(async () => {});
    expect(mockCompleteFlowAfterFrame).not.toHaveBeenCalled();

    mockUseSectionDetailPerformance.mockImplementation(() => performanceRead);
    await screen.rerender(<SectionDetailScreen />);
    await act(async () => {});
    expect(mockCompleteFlowAfterFrame).toHaveBeenCalledTimes(1);
    expect(mockCompleteFlowAfterFrame).toHaveBeenCalledWith('section-open');

    await act(async () => {
      capturedSaveName?.('Hill');
    });
    expect(mockCompleteFlowAfterFrame).toHaveBeenCalledTimes(1);
  });

  it('completes on the first frame when the read answers at mount', async () => {
    mockUseSectionDetailPerformance.mockImplementation(() => performanceRead);
    await render(<SectionDetailScreen />);
    await act(async () => {});
    expect(mockCompleteFlowAfterFrame).toHaveBeenCalledTimes(1);
  });

  it('does not complete while the read has failed', async () => {
    mockUseSectionDetailPerformance.mockImplementation(() => ({
      data: undefined,
      error: new Error('engine closed'),
    }));
    await render(<SectionDetailScreen />);
    await act(async () => {});
    expect(mockCompleteFlowAfterFrame).not.toHaveBeenCalled();
  });
});

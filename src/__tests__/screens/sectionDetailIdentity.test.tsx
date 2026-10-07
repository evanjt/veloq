/**
 * Scenario: the section detail screen hands its hooks values it builds from the
 * engine's bundle. Built inline, a fresh object per render defeated their
 * memoisation on every rename keystroke, because each keystroke re-renders the
 * screen root.
 *
 * Expected behaviour: a re-render with the same bundle passes the same section,
 * refresh callback and excluded-id list to `useSectionActions` and
 * `useSectionTrim`, the same ledger to `useSectionLedger` and the same id lists
 * to `useSectionTimeStreamSync`, so those hooks' memoisation holds across a
 * keystroke.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import SectionDetailScreen from '@/app/section/[id]';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
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
  EngineReadFailure: () => null,
  useHeroMapHeight: () => 300,
}));
jest.mock('@/features/settings', () => ({
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
  useDebugStore: (select: (s: { enabled: boolean }) => unknown) => select({ enabled: false }),
}));

const mockSection = {
  id: 'sec-1',
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
  refetch: () => {},
}));
const mockUseSectionActions = jest.fn((_options: Record<string, unknown>) => ({}));
const mockUseSectionTrim = jest.fn((..._args: unknown[]) => ({}));

let capturedEditNameChange: ((name: string) => void) | undefined;

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
    useRevealMapOnDraw: noop,
    useRevealMapOnHighlight: noop,
    createMapHighlightStore: jest.requireActual('@/features/routes/lib/mapHighlight')
      .createMapHighlightStore,
    useMergeSections: () => ({ merge: noop, previewDropped: false }),
    useSectionDetailData: () => ({ data: mockDetail, status: 'ready', retirement: undefined }),
    useSectionDetailPerformance: () => ({ data: undefined, error: undefined }),
    useSectionTimeStreamSync: (...args: unknown[]) => mockUseSectionTimeStreamSync(...args),
    useSectionChartData: () => ({ chartData: [] }),
    useSectionChartDataEnriched: () => ({ calendarSummary: null, combinedChartData: [] }),
    useSectionMapData: () => ({ isRunning: false }),
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
        mergeTarget: null,
        setMergeTarget: noop,
        showMergePicker: false,
        setShowMergePicker: noop,
        sectionTimeRange: '3m',
        setSectionTimeRange: noop,
        selectedSportType: undefined,
        setSelectedSportType: noop,
      };
    },
    // The rename draft lives inside this hook, as in the real one, so typing
    // re-renders the screen root through it.
    useSectionActions: (options: Record<string, unknown>) => {
      mockUseSectionActions(options);
      const [editName, setEditName] = React.useState('');
      return { editName, setEditName };
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
    SectionContentArea: component,
    SectionDebugPanel: component,
    SectionDetailLinks: component,
    MergeConfirmDialog: component,
    MergeCandidatesModal: component,
    SectionHeader: (props: { onEditNameChange: (name: string) => void }) => {
      capturedEditNameChange = props.onEditNameChange;
      return null;
    },
  };
});

describe('section detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedEditNameChange = undefined;
  });

  it('keeps what it hands its hooks stable across a rename keystroke', async () => {
    render(<SectionDetailScreen />);
    await act(async () => {});

    const actionsBefore = mockUseSectionActions.mock.calls.at(-1)?.[0];
    const trimBefore = mockUseSectionTrim.mock.calls.at(-1);
    const ledgerBefore = mockUseSectionLedger.mock.calls.at(-1);
    const streamsBefore = mockUseSectionTimeStreamSync.mock.calls.at(-1);
    expect(actionsBefore?.preComputedExcludedActivityIds).toEqual(['a2']);
    expect(ledgerBefore?.[2]).toEqual({ history: [], geometryVersions: [], pinnedVersion: null });
    expect(streamsBefore?.[0]).toEqual(['a1']);
    const renders = mockUseSectionActions.mock.calls.length;

    await act(async () => {
      capturedEditNameChange?.('Hill');
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
    expect(mockUseSectionLedger.mock.calls.at(-1)?.[2]).toBe(ledgerBefore?.[2]);
    expect(mockUseSectionTimeStreamSync.mock.calls.at(-1)?.[0]).toBe(streamsBefore?.[0]);
    expect(mockUseSectionTimeStreamSync.mock.calls.at(-1)?.[1]).toBe(streamsBefore?.[1]);
  });
});

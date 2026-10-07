/**
 * Scenario: the detail screen opens on an activity whose body and stream
 * reads are still pending, and the feed card just tapped left a poster on disk.
 *
 * Expected behaviour: the first frame is the screen's own shape. The hero slot
 * paints the cached poster and the chart blocks sit under it. Without a poster
 * the hero is an empty block of the same height.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ActivityDetailScreen from '@/app/activity/[id]';
import { ACTIVITY_MAP_POSTER_TEST_ID } from '@/features/maps';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'act-1' }),
  router: { back: jest.fn(), push: jest.fn(), canGoBack: () => false },
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  const React = require('react');
  return {
    ScreenSafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => {
      React.useLayoutEffect(() => {
        mockFirstFrameCommitted = true;
      }, []);
      return <View {...props}>{children}</View>;
    },
    ChartSkeleton: () => <View testID="chart-skeleton" />,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorStatePreset: () => null,
    useHeroMapHeight: () => 300,
    HERO_HEADER_HEIGHT: 48,
    Shimmer: () => <View testID="shimmer" />,
    SwipeableTabs: () => null,
  };
});

jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => {
    mockActivityReadCommits.push(mockFirstFrameCommitted);
    return { data: undefined, isLoading: true, bodyStatus: 'pending' };
  },
  useActivityDetailStreams: () => ({ data: undefined, isLoading: true, coordinates: [] }),
  useActivityStreams: () => ({ data: undefined, isLoading: true }),
  useActivityIntervals: (...args: unknown[]) => {
    mockIntervalsIds.push(args[0]);
    return { data: undefined };
  },
  useActivitySectionHighlights: () => ({ routes: new Map() }),
  useSectionOverlays: () => ({ sectionOverlays: [] }),
}));
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: (...args: unknown[]) => {
    mockDetailEnabled.push(args[1]);
    return { data: undefined };
  },
}));
jest.mock('@/features/routes/hooks/useActivityRematch', () => ({
  useActivityRematch: () => ({ matches: [], scan: jest.fn(), rematch: jest.fn() }),
}));
jest.mock('@/features/wellness', () => ({ useWellnessForDate: () => ({ data: undefined }) }));
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ createSection: jest.fn(), removeSection: jest.fn(), sections: [] }),
}));
jest.mock('@/features/routes/hooks/useRouteMatch', () => ({
  useRouteMatch: () => ({ routeGroup: null, representativeActivityId: null }),
}));
jest.mock('@/features/routes/hooks/useSectionMatches', () => ({
  useSectionMatches: () => ({ sections: [], count: 0, isReady: false }),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: () => ({ settings: {} }),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: () => false,
}));
jest.mock('@/features/strength', () => ({
  useExerciseSets: () => ({ data: undefined }),
  ExerciseTable: () => null,
  MuscleGroupView: () => null,
}));
const mockCached = new Set<string>();
let mockFirstFrameCommitted = false;
const mockActivityReadCommits: boolean[] = [];
const mockIntervalsIds: unknown[] = [];
const mockDetailEnabled: unknown[] = [];
const mockFrames: FrameRequestCallback[] = [];

function flushFrame() {
  act(() => {
    const callbacks = mockFrames.splice(0);
    callbacks.forEach((callback) => callback(0));
  });
}
jest.mock('@/features/maps', () => ({
  ACTIVITY_MAP_POSTER_TEST_ID: 'activity-map-poster',
  calculateTerrainCamera: jest.fn(),
  deleteCameraOverride: jest.fn(),
  getCameraOverride: () => null,
  setCameraOverride: jest.fn(),
  sectionCreationMessageKey: jest.fn(),
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}-${style}-${is3D}`),
  getTerrainPreviewUri: (id: string, style: string, is3D: boolean) =>
    `file:///previews/${id}-${style}-${is3D}.jpg`,
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

beforeEach(() => {
  mockCached.clear();
  mockFirstFrameCommitted = false;
  mockActivityReadCommits.length = 0;
  mockIntervalsIds.length = 0;
  mockDetailEnabled.length = 0;
  mockFrames.length = 0;
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    mockFrames.push(callback);
    return mockFrames.length;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('activity detail first paint', () => {
  it('paints the cached poster in a hero slot while the reads are pending', () => {
    mockCached.add('act-1-light-false');

    render(<ActivityDetailScreen />);

    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID).props.source).toEqual({
      uri: 'file:///previews/act-1-light-false.jpg',
    });
    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID).props.fadeDuration).toBe(0);
    expect(screen.getByTestId('activity-detail-skeleton-hero')).toBeTruthy();
    expect(screen.getAllByTestId('chart-skeleton').length).toBeGreaterThan(0);
  });

  it('keeps an empty hero of the same slot when no poster exists', () => {
    render(<ActivityDetailScreen />);

    expect(screen.getByTestId('activity-detail-skeleton-hero')).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeNull();
  });

  it('starts detail reads after the poster loads and a frame has passed', () => {
    mockCached.add('act-1-light-false');
    render(<ActivityDetailScreen />);

    expect(mockActivityReadCommits).toEqual([]);
    fireEvent(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID), 'load');
    flushFrame();
    expect(mockActivityReadCommits).toEqual([]);
    flushFrame();

    expect(mockIntervalsIds).toEqual(['act-1']);
    expect(mockDetailEnabled).toEqual([undefined]);
    expect(mockActivityReadCommits).toEqual([true]);
  });

  it('continues after an empty poster slot commits', () => {
    render(<ActivityDetailScreen />);
    flushFrame();
    flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });

  it('continues when a cached poster fails to load', () => {
    mockCached.add('act-1-light-false');
    render(<ActivityDetailScreen />);
    fireEvent(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID), 'error');
    flushFrame();
    flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });

  it('continues when a cached poster sends no load event', () => {
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame'] });
    mockCached.add('act-1-light-false');
    render(<ActivityDetailScreen />);

    act(() => jest.advanceTimersByTime(250));
    flushFrame();
    flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });
});

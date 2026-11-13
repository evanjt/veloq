/**
 * Scenario: the detail screen opens on an activity whose body and stream
 * reads are still pending, and the feed card just tapped left a poster on disk.
 *
 * Expected behaviour: the first frame is the map screen's own shape. The ground
 * paints the cached poster under the sheet's Peek blocks. Without a poster the
 * ground is the map's bare land, under the same Peek blocks.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ActivityDetailScreen from '@/app/activity/[id]';

const POSTER = 'map-detail-skeleton-preview';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  useLocalSearchParams: () => ({ id: 'act-1' }),
  router: { back: jest.fn(), push: jest.fn(), canGoBack: () => false },
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => {},
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui/MapDetailSkeleton', () => {
  const React = require('react');
  const actual = jest.requireActual('@/shared/ui/MapDetailSkeleton');
  return {
    ...actual,
    MapDetailSkeleton: (props: object) => {
      React.useLayoutEffect(() => {
        mockFirstFrameCommitted = true;
      }, []);
      return <actual.MapDetailSkeleton {...props} />;
    },
  };
});
jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    ScreenSafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => (
      <View {...props}>{children}</View>
    ),
    ChartSkeleton: () => <View testID="chart-skeleton" />,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorState: () => null,
    useHeroMapHeight: () => 300,
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
  useActivitySectionHighlights: () => ({ routes: new Map(), newGround: new Map() }),
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

async function flushFrame() {
  await act(() => {
    const callbacks = mockFrames.splice(0);
    callbacks.forEach((callback) => callback(0));
  });
}
jest.mock('@/features/maps', () => ({
  calculateTerrainCamera: jest.fn(),
  deleteCameraOverride: jest.fn(),
  getCameraOverride: () => null,
  setCameraOverride: jest.fn(),
  submitSectionCreation: jest.fn(),
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}-${style}-${is3D}`),
  getTerrainPreviewUri: (id: string, style: string, is3D: boolean) =>
    `file:///previews/${id}-${style}-${is3D}.jpg`,
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
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
  it('paints the cached poster under the Peek blocks while the reads are pending', async () => {
    mockCached.add('act-1-light-false');

    await render(<ActivityDetailScreen />);

    const poster = screen.getByTestId(POSTER, { includeHiddenElements: true });
    expect(poster.props.source).toEqual({ uri: 'file:///previews/act-1-light-false.jpg' });
    expect(poster.props.fadeDuration).toBe(0);
    expect(
      screen.getByTestId('map-detail-skeleton-peek', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(screen.getByLabelText('maps.detailLoading.activity')).toBeTruthy();
  });

  it('prefers the 3D poster the feed card drew over the flat one', async () => {
    mockCached.add('act-1-light-true');
    mockCached.add('act-1-light-false');

    await render(<ActivityDetailScreen />);

    expect(screen.getByTestId(POSTER, { includeHiddenElements: true }).props.source).toEqual({
      uri: 'file:///previews/act-1-light-true.jpg',
    });
  });

  it('stands on the bare land under the same Peek blocks when no poster exists', async () => {
    await render(<ActivityDetailScreen />);

    expect(
      screen.getByTestId('map-detail-skeleton-ground', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(
      screen.getByTestId('map-detail-skeleton-peek', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(screen.queryByTestId(POSTER, { includeHiddenElements: true })).toBeNull();
  });

  it('starts detail reads after the poster loads and a frame has passed', async () => {
    mockCached.add('act-1-light-false');
    await render(<ActivityDetailScreen />);

    expect(mockActivityReadCommits).toEqual([]);
    await fireEvent(screen.getByTestId(POSTER, { includeHiddenElements: true }), 'load');
    await flushFrame();
    expect(mockActivityReadCommits).toEqual([]);
    await flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
    // The card makes the detail reads once the activity is read, so none runs while it loads.
    expect(mockIntervalsIds).toEqual([]);
    expect(mockDetailEnabled).toEqual([]);
  });

  it('continues after an empty poster slot commits', async () => {
    await render(<ActivityDetailScreen />);
    await flushFrame();
    await flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });

  it('continues when a cached poster fails to load', async () => {
    mockCached.add('act-1-light-false');
    await render(<ActivityDetailScreen />);
    await fireEvent(screen.getByTestId(POSTER, { includeHiddenElements: true }), 'error');
    await flushFrame();
    await flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });

  it('continues when a cached poster sends no load event', async () => {
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame'] });
    mockCached.add('act-1-light-false');
    await render(<ActivityDetailScreen />);

    await act(() => jest.advanceTimersByTime(250));
    await flushFrame();
    await flushFrame();

    expect(mockActivityReadCommits).toEqual([true]);
  });
});

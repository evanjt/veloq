/**
 * Scenario: a deep link or push opens the detail screen for an activity the
 * library has never held, while its download is still running.
 *
 * Expected behaviour: the screen says it is downloading, not that loading
 * failed. Once the wait runs out it offers a retry that asks the engine again.
 * Offline or signed out, the engine starts nothing, so the screen says what
 * will fix it at once and offers no retry that cannot work. A real query
 * error keeps the failure state and re-reads the row.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { getHeaderTitle } from 'expo-router/build/react-navigation/elements/Header/getHeaderTitle';

import { colors } from '@/theme';
import { OVER_MAP_TITLE_COLOR } from '@/shared/app/screenHeaders';
import ActivityDetailScreen from '@/app/activity/[id]';

const mockStackScreen = jest.fn();

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'act-9' }),
  router: { back: jest.fn(), push: jest.fn() },
  Stack: Object.assign(() => null, {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  }),
}));
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => {},
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/components/ActivityDetailSkeleton', () => ({
  ActivityDetailSkeleton: ({ onPosterSettled }: { onPosterSettled?: () => void }) => {
    const React = require('react');
    React.useEffect(() => onPosterSettled?.(), [onPosterSettled]);
    return null;
  },
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui', () => {
  const { View, Text } = require('react-native');
  return {
    Spinner: jest.requireActual('@/shared/ui/Spinner').Spinner,
    ScreenSafeAreaView: View,
    ChartSkeleton: () => null,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorState: ({ fallbackKey, onRetry }: { fallbackKey: string; onRetry: () => void }) => (
      <View testID="error-state" onTouchEnd={onRetry}>
        <Text>{fallbackKey}</Text>
      </View>
    ),
    useHeroMapHeight: () => 300,
    SwipeableTabs: () => null,
    BodyNotDownloaded: jest.requireActual('@/shared/ui/BodyNotDownloaded').BodyNotDownloaded,
  };
});
jest.mock('@/shared/ui/Button', () => {
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({
      label,
      onPress,
      testID,
    }: {
      label: string;
      onPress: () => void;
      testID: string;
    }) => (
      <Pressable onPress={onPress} testID={testID}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

const mockUseActivity = jest.fn();
jest.mock('@/features/activity/hooks', () => ({
  useActivity: (...args: unknown[]) => mockUseActivity(...args),
  useActivityDetailStreams: () => ({ data: undefined, isLoading: false, coordinates: [] }),
  useActivityStreams: () => ({ data: undefined, isLoading: false }),
  useActivityIntervals: () => ({ data: undefined }),
  useActivitySectionHighlights: () => ({ routes: new Map(), newGround: new Map() }),
  useSectionOverlays: () => ({ sectionOverlays: [] }),
}));
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: () => ({ data: undefined }),
}));
jest.mock('@/features/routes/hooks/useActivityRematch', () => ({
  useActivityRematch: () => ({
    matches: [],
    scan: jest.fn(),
    rematch: jest.fn(),
  }),
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
  useSectionMatches: () => ({
    sections: [],
    count: 0,
    isReady: false,
    isLoading: false,
    timedOut: false,
  }),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: (sel: (s: { settings: { enabled: boolean } }) => unknown) =>
    sel({ settings: { enabled: true } }),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: (sel: (s: { enabled: boolean }) => unknown) => sel({ enabled: false }),
}));
jest.mock('@/features/strength', () => ({
  useExerciseSets: () => ({ data: undefined }),
  ExerciseTable: () => null,
  MuscleGroupView: () => null,
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  setCameraOverride: jest.fn(),
  getCameraOverride: jest.fn(),
  deleteCameraOverride: jest.fn(),
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getTerrain3DMode: () => false,
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
  }),
}));

function answer(overrides: Record<string, unknown>) {
  mockUseActivity.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    bodyStatus: 'waiting',
    retryBody: jest.fn(),
    ...overrides,
  });
}

describe('activity detail for an activity that is not stored', () => {
  beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('says it is downloading while the body wait runs', async () => {
    answer({});

    const { getByTestId, queryByTestId } = await render(<ActivityDetailScreen />);

    expect(getByTestId('activity-detail-waiting')).toHaveTextContent('activitySummary.downloading');
    expect(queryByTestId('error-state')).toBeNull();
  });

  it('offers a retry that asks the engine again once the wait has timed out', async () => {
    const retryBody = jest.fn();
    const refetch = jest.fn();
    answer({ bodyStatus: 'timedOut', retryBody, refetch });

    const { getByTestId, queryByTestId } = await render(<ActivityDetailScreen />);

    expect(queryByTestId('activity-detail-waiting')).toBeNull();
    expect(getByTestId('error-state')).toHaveTextContent('activitySummary.unavailable');
    await fireEvent(getByTestId('error-state'), 'touchEnd');
    expect(retryBody).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', 'refresh.offline'],
    ['notConfigured', 'settings.streamBackfillRefusedNotConfigured'],
  ])(
    'says what fixes a download refused %s, with no retry and no spinner',
    async (status, reason) => {
      answer({ bodyStatus: status });

      const { getByTestId, queryByTestId } = await render(<ActivityDetailScreen />);

      expect(queryByTestId('activity-detail-waiting')).toBeNull();
      expect(queryByTestId('error-state')).toBeNull();
      const block = getByTestId('activity-detail-not-downloaded');
      expect(block).toHaveTextContent(/activitySummary\.notDownloaded/);
      expect(block).toHaveTextContent(new RegExp(reason.replace('.', '\\.')));
      expect(queryByTestId('activity-detail-not-downloaded-retry')).toBeNull();
    }
  );

  it('keeps the failure state and a re-read for a real query error', async () => {
    const retryBody = jest.fn();
    const refetch = jest.fn();
    answer({ error: new Error('read failed'), retryBody, refetch });

    const { getByTestId, queryByTestId } = await render(<ActivityDetailScreen />);

    expect(queryByTestId('activity-detail-waiting')).toBeNull();
    expect(getByTestId('error-state')).toHaveTextContent('activityDetail.failedToLoad');
    await fireEvent(getByTestId('error-state'), 'touchEnd');
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retryBody).not.toHaveBeenCalled();
  });

  it('tints the back chevron for the page background when a loaded activity has no map', async () => {
    mockStackScreen.mockClear();
    answer({
      data: {
        id: 'act-9',
        name: 'Trainer ride',
        sportType: 'VirtualRide',
        startDateLocal: '2026-01-01T07:00:00',
      },
      bodyStatus: 'ready',
    });

    await render(<ActivityDetailScreen />);

    const tints = mockStackScreen.mock.calls.map(
      ([props]) => (props as { options?: { headerTintColor?: string } }).options?.headerTintColor
    );
    expect(tints).toContain(colors.textPrimary);
  });

  it('titles the opaque platform header with the name of a loaded activity that has no map', async () => {
    mockStackScreen.mockClear();
    answer({
      data: {
        id: 'act-9',
        name: 'Trainer ride',
        sportType: 'VirtualRide',
        startDateLocal: '2026-01-01T07:00:00',
      },
      bodyStatus: 'ready',
    });

    const { queryByText } = await render(<ActivityDetailScreen />);

    expect(lastHeaderOptions()).toMatchObject({
      headerTransparent: false,
      headerTitleStyle: { color: colors.textPrimary },
    });
    expect(lastHeaderTitle()).toBe('Trainer ride');
    expect(queryByText('Trainer ride')).toBeNull();
  });

  it('starts the waiting and failed states directly under an opaque header, with no spacer', async () => {
    for (const overrides of [{}, { error: new Error('read failed') }]) {
      mockStackScreen.mockClear();
      answer(overrides);

      const { toJSON, unmount } = await render(<ActivityDetailScreen />);

      expect(lastHeaderOptions()).toMatchObject({ headerTransparent: false });
      const root = toJSON() as { props: { testID?: string }; children: unknown[] };
      expect(root.props.testID).toBe('activity-detail-screen');
      expect(root.children).toHaveLength(1);
      await unmount();
    }
  });

  it('puts the transparent header back once a waiting activity loads with a hero', async () => {
    mockStackScreen.mockClear();
    answer({});
    const { rerender } = await render(<ActivityDetailScreen />);
    expect(lastHeaderOptions()).toMatchObject({ headerTransparent: false });

    answer({
      data: {
        id: 'act-9',
        name: 'Leg day',
        sportType: 'WeightTraining',
        startDateLocal: '2026-01-01T07:00:00',
      },
      bodyStatus: 'ready',
    });
    await rerender(<ActivityDetailScreen />);

    expect(lastHeaderOptions()).toMatchObject({
      headerTransparent: true,
      headerTitleStyle: { color: OVER_MAP_TITLE_COLOR },
    });
    expect(lastHeaderTitle()).toBe('Leg day');
  });
});

function lastHeaderOptions(): Record<string, unknown> | undefined {
  const calls = mockStackScreen.mock.calls;
  return (calls[calls.length - 1]?.[0] as { options?: Record<string, unknown> })?.options;
}

/** The title the native stack hands the navigation item for the last options the screen set. */
function lastHeaderTitle(): string {
  return getHeaderTitle(lastHeaderOptions() as { title?: string }, 'activity/[id]');
}

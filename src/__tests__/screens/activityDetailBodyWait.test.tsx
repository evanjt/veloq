/**
 * Scenario: a deep link or push opens the detail screen for an activity the
 * library has never held, while its download is still running.
 *
 * Expected behaviour: the screen says it is downloading, not that loading
 * failed. Once the wait runs out it offers a retry that asks the engine again.
 * A real query error keeps the failure state and re-reads the row.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { colors } from '@/theme';
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
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
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
    ScreenSafeAreaView: View,
    ChartSkeleton: () => null,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorStatePreset: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
      <View testID="error-state" onTouchEnd={onRetry}>
        <Text>{message}</Text>
      </View>
    ),
    useHeroMapHeight: () => 300,
    SwipeableTabs: () => null,
  };
});

const mockUseActivity = jest.fn();
jest.mock('@/features/activity/hooks', () => ({
  useActivity: (...args: unknown[]) => mockUseActivity(...args),
  useActivityDetailStreams: () => ({ data: undefined, isLoading: false, coordinates: [] }),
  useActivityStreams: () => ({ data: undefined, isLoading: false }),
  useActivityIntervals: () => ({ data: undefined }),
  useActivitySectionHighlights: () => ({ routes: new Map() }),
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
jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getTerrain3DMode: () => false, setActivityOverride: jest.fn() }),
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
  it('says it is downloading while the body wait runs', () => {
    answer({});

    const { getByTestId, queryByTestId } = render(<ActivityDetailScreen />);

    expect(getByTestId('activity-detail-waiting')).toHaveTextContent('activitySummary.downloading');
    expect(queryByTestId('error-state')).toBeNull();
  });

  it('offers a retry that asks the engine again once the wait has timed out', () => {
    const retryBody = jest.fn();
    const refetch = jest.fn();
    answer({ bodyStatus: 'timedOut', retryBody, refetch });

    const { getByTestId, queryByTestId } = render(<ActivityDetailScreen />);

    expect(queryByTestId('activity-detail-waiting')).toBeNull();
    expect(getByTestId('error-state')).toHaveTextContent('activitySummary.unavailable');
    fireEvent(getByTestId('error-state'), 'touchEnd');
    expect(retryBody).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('keeps the failure state and a re-read for a real query error', () => {
    const retryBody = jest.fn();
    const refetch = jest.fn();
    answer({ error: new Error('read failed'), retryBody, refetch });

    const { getByTestId, queryByTestId } = render(<ActivityDetailScreen />);

    expect(queryByTestId('activity-detail-waiting')).toBeNull();
    expect(getByTestId('error-state')).toHaveTextContent('activityDetail.failedToLoad');
    fireEvent(getByTestId('error-state'), 'touchEnd');
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retryBody).not.toHaveBeenCalled();
  });

  it('tints the back chevron for the page background when a loaded activity has no map', () => {
    mockStackScreen.mockClear();
    answer({
      data: {
        id: 'act-9',
        name: 'Trainer ride',
        type: 'VirtualRide',
        start_date_local: '2026-01-01T07:00:00',
      },
      bodyStatus: 'ready',
    });

    render(<ActivityDetailScreen />);

    const tints = mockStackScreen.mock.calls.map(
      ([props]) => (props as { options?: { headerTintColor?: string } }).options?.headerTintColor
    );
    expect(tints).toContain(colors.textPrimary);
  });
});

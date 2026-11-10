/**
 * Scenario: the detail bundle read throws while the athlete opens an activity.
 * With no GPS track the card is drawn as a plain screen, and the read failure
 * must still show there with a retry, not only on the Routes and Sections tabs
 * that a track brings.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ActivityDetailCard } from '@/features/activity/components/ActivityDetailCard';
import {
  MapSheetHostContext,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));

jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    SwipeableTabs: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockActivity = {
  id: 'act-1',
  name: 'Indoor Ride',
  sportType: 'VirtualRide',
  startDateLocal: '2026-11-01T08:00:00',
  movingTime: 3600,
  distance: 30000,
  elevationGain: 0,
  streamTypes: [],
};

let mockTrack: { latitude: number; longitude: number }[] = [];

jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => ({ data: mockActivity, isLoading: false, error: null, refetch: jest.fn() }),
  useActivityDetailStreams: () => ({
    data: undefined,
    isLoading: false,
    isDownloaded: true,
    coordinates: mockTrack,
  }),
  useActivityIntervals: () => ({ data: undefined }),
  useActivitySectionHighlights: () => ({ routes: new Map(), newGround: new Map() }),
}));

let mockDetailRead: { data: unknown; error: unknown; refresh: jest.Mock };
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: () => mockDetailRead,
}));
jest.mock('@/features/activity/hooks/useRetryActivitySync', () => ({
  useRetryActivitySync: () => ({ retry: jest.fn() }),
}));
jest.mock('@/features/activity/components/ActivityChartsSection', () => ({
  ActivityChartsSection: () => null,
}));
jest.mock('@/features/activity/components/ActivityRoutesSection', () => ({
  ActivityRoutesSection: () => null,
}));
jest.mock('@/features/activity/components/ActivitySectionsSection', () => ({
  ActivitySectionsSection: () => null,
}));

jest.mock('@/features/routes', () => ({
  useActivityRematch: () => ({
    matches: [],
    hasScanned: false,
    scan: jest.fn(),
    rematch: jest.fn(),
  }),
  useCustomSections: () => ({ removeSection: jest.fn(), sections: [] }),
  useRouteMatch: () => ({ routeGroup: null }),
  useRouteSettings: (sel: (s: { settings: { enabled: boolean } }) => unknown) =>
    sel({ settings: { enabled: true } }),
  useSectionMatches: () => ({ count: 0 }),
}));
jest.mock('@/features/wellness', () => ({ useWellnessForDate: () => ({ data: undefined }) }));
jest.mock('@/features/settings', () => ({
  useDebugStore: (sel: (s: { enabled: boolean }) => unknown) => sel({ enabled: false }),
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/features/strength', () => ({
  useExerciseSets: () => ({ data: undefined }),
  ExerciseTable: () => null,
  MuscleGroupView: () => null,
}));

/** The card as the plain-screen route draws it, inside the host it reads its tab from. */
function PlainActivityScreen() {
  const key = useMapSheetHostEntry('activity', 'act-1');
  const host = React.useMemo<MapSheetHostValue>(
    () => ({
      kind: 'activity',
      id: 'act-1',
      key,
      focused: true,
      setHeaderOptions: () => {},
    }),
    [key]
  );
  return (
    <MapSheetHostContext.Provider value={host}>
      <ActivityDetailCard id="act-1" variant="screen" />
    </MapSheetHostContext.Provider>
  );
}

describe('a failed detail read on an activity with no GPS track', () => {
  beforeEach(() => {
    mockTrack = [];
    mockDetailRead = { data: null, error: new Error('lock timed out'), refresh: jest.fn() };
  });

  it('shows the read failure with a retry that re-reads the bundle', async () => {
    const view = await render(<PlainActivityScreen />);
    await act(async () => {});

    expect(view.getByText('activityDetail.failedToLoad')).toBeTruthy();
    await fireEvent.press(view.getByTestId('activity-detail-read-failed-retry'));

    expect(mockDetailRead.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows no read failure once the bundle reads', async () => {
    mockDetailRead = { data: {}, error: undefined, refresh: jest.fn() };

    const view = await render(<PlainActivityScreen />);
    await act(async () => {});

    expect(view.queryByTestId('activity-detail-read-failed-retry')).toBeNull();
    expect(view.queryByText('activityDetail.failedToLoad')).toBeNull();
  });

  it('shows the read failure beside the Routes and Sections stand-ins when there is a track', async () => {
    mockTrack = [
      { latitude: 1, longitude: 2 },
      { latitude: 3, longitude: 4 },
    ];

    const view = await render(<PlainActivityScreen />);
    await act(async () => {});

    expect(view.getByTestId('activity-detail-read-failed-retry')).toBeTruthy();
  });
});

/**
 * Scenario: the activity detail screen hands pre-computed bundles to its
 * section hooks. Built inline, a fresh object per render re-decoded every
 * matched polyline on every chart-scrub frame.
 *
 * Expected behaviour: a re-render with the same detail passes the same
 * `preComputed` objects to `useSectionMatches` and `useSectionOverlays`, so
 * the hooks' memoisation holds across a scrub.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import ActivityDetailScreen from '@/app/activity/[id]';

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides()
);

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'act-1' }),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));

jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    ScreenSafeAreaView: View,
    ChartSkeleton: () => null,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorStatePreset: () => null,
    useHeroMapHeight: () => 300,
    SwipeableTabs: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockActivity = {
  id: 'act-1',
  name: 'Morning Ride',
  type: 'Ride',
  start_date_local: '2026-09-01T08:00:00',
  polyline: null,
};

jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => ({ data: mockActivity, isLoading: false, error: null, refetch: jest.fn() }),
  useActivityStreams: () => ({ data: undefined, isLoading: false }),
  useActivityIntervals: () => ({ data: undefined }),
}));

const mockDetail = {
  matchedSections: [],
  sectionCount: 0,
  sectionTraces: {},
  prSectionIds: new Set<string>(),
  customSections: [],
  encounters: [],
  highlights: [],
  routeGroups: [],
  activityCount: 1,
};
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: () => ({ data: mockDetail }),
}));

const mockUseSectionMatches = jest.fn(() => ({ sections: [], count: 0 }));
jest.mock('@/features/routes/hooks/useSectionMatches', () => ({
  useSectionMatches: (...args: unknown[]) => mockUseSectionMatches(...args),
}));
const mockUseSectionOverlays = jest.fn(() => ({ sectionOverlays: [] }));
jest.mock('@/features/activity/hooks/useSectionOverlays', () => ({
  useSectionOverlays: (...args: unknown[]) => mockUseSectionOverlays(...args),
}));

jest.mock('@/features/routes/hooks/useActivityRematch', () => ({
  useActivityRematch: () => ({
    matches: [],
    scan: jest.fn(),
    rematch: jest.fn(),
    isRematching: false,
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
jest.mock('@/features/routes/hooks/useSectionEncounters', () => ({
  useSectionEncounters: () => ({ encounters: [], isLoading: false }),
}));
jest.mock('@/features/activity/hooks/useActivitySectionHighlights', () => ({
  useActivitySectionHighlights: () => ({ routes: new Map() }),
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

let capturedOnPointSelect: ((index: number | null) => void) | null = null;
jest.mock('@/features/activity/components/ActivityChartsSection', () => ({
  ActivityChartsSection: (props: { onPointSelect: (index: number | null) => void }) => {
    capturedOnPointSelect = props.onPointSelect;
    return null;
  },
}));
jest.mock('@/features/activity/components/ActivityHeader', () => ({ ActivityHeader: () => null }));
jest.mock('@/features/activity/components/ActivityRoutesSection', () => ({
  ActivityRoutesSection: () => null,
}));
jest.mock('@/features/activity/components/ActivitySectionsSection', () => ({
  ActivitySectionsSection: () => null,
}));

describe('activity detail screen', () => {
  it('keeps the pre-computed bundles it hands its hooks stable across a scrub', async () => {
    render(<ActivityDetailScreen />);
    await act(async () => {});
    const matchesBefore = mockUseSectionMatches.mock.calls.at(-1)?.[1];
    const overlaysBefore = mockUseSectionOverlays.mock.calls.at(-1)?.[5];
    expect(matchesBefore).toEqual({ sections: [], sectionCount: 0 });

    await act(async () => {
      capturedOnPointSelect?.(12);
    });

    expect(mockUseSectionMatches.mock.calls.length).toBeGreaterThan(1);
    expect(mockUseSectionMatches.mock.calls.at(-1)?.[1]).toBe(matchesBefore);
    expect(mockUseSectionOverlays.mock.calls.at(-1)?.[5]).toBe(overlaysBefore);
  });
});

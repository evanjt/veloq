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

import type { Section } from '@/types';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';
import type { UseSectionEncountersResult } from '@/features/routes/hooks/useSectionEncounters';
import type {
  PreComputedSectionMatches,
  SectionMatch,
  UseSectionMatchesResult,
} from '@/features/routes/hooks/useSectionMatches';
import ActivityDetailScreen from '@/app/activity/[id]';
import type { PreComputedOverlays } from '@/features/activity/hooks/useSectionOverlays';
import type { SectionEncounter } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-safe-area-context', () => {
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
  useActivityStreams: () => ({
    data: {
      latlng: [
        [1, 2],
        [3, 4],
      ],
    },
    isLoading: false,
  }),
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

const mockUseSectionMatches = jest.fn<
  UseSectionMatchesResult,
  [string | undefined, PreComputedSectionMatches]
>(() => ({
  sections: [],
  count: 0,
  isReady: false,
  isLoading: false,
  timedOut: false,
}));
jest.mock('@/features/routes/hooks/useSectionMatches', () => ({
  useSectionMatches: (activityId: string | undefined, bundle: PreComputedSectionMatches) =>
    mockUseSectionMatches(activityId, bundle),
}));
const mockUseSectionOverlays = jest.fn<
  { sectionOverlays: SectionOverlay[] | null },
  [
    activeTab: string,
    activityId: string | undefined,
    engineSectionMatches: SectionMatch[],
    customMatchedSections: Section[],
    coordinates: { latitude: number; longitude: number }[],
    bundle: PreComputedOverlays,
    sectionEncounters?: SectionEncounter[],
  ]
>(() => ({ sectionOverlays: [] }));
jest.mock('@/features/activity/hooks/useSectionOverlays', () => ({
  useSectionOverlays: (
    activeTab: string,
    activityId: string | undefined,
    engineSectionMatches: SectionMatch[],
    customMatchedSections: Section[],
    coordinates: { latitude: number; longitude: number }[],
    bundle: PreComputedOverlays,
    sectionEncounters?: SectionEncounter[]
  ) =>
    mockUseSectionOverlays(
      activeTab,
      activityId,
      engineSectionMatches,
      customMatchedSections,
      coordinates,
      bundle,
      sectionEncounters
    ),
}));
const mockUseSectionEncounters = jest.fn<UseSectionEncountersResult, [SectionEncounter[]]>(() => ({
  encounters: [],
  isLoading: false,
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
  useSectionEncounters: (encounters: SectionEncounter[]) => mockUseSectionEncounters(encounters),
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
let capturedSectionEncounters: { sectionId: string; direction: string }[] = [];
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
  ActivitySectionsSection: (props: { encounters: { sectionId: string; direction: string }[] }) => {
    capturedSectionEncounters = props.encounters;
    return null;
  },
}));

describe('activity detail screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedSectionEncounters = [];
    capturedOnPointSelect = null;
    mockUseSectionOverlays.mockReset();
    mockUseSectionOverlays.mockImplementation(() => ({ sectionOverlays: [] }));
    mockUseSectionEncounters.mockReset();
    mockUseSectionEncounters.mockReturnValue({ encounters: [], isLoading: false });
  });

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

  it('orders section encounters by section + direction for forward and reverse duplicates', async () => {
    mockUseSectionEncounters.mockReturnValue({
      encounters: [
        {
          sectionId: 'sec-65',
          sectionName: 'Section 65',
          direction: 'reverse',
          distanceMeters: 900,
          lapTime: 120,
          lapPace: 2.1,
          isPr: false,
          visitCount: 5,
          historyTimes: [],
          historyActivityIds: [],
        },
        {
          sectionId: 'sec-65',
          sectionName: 'Section 65',
          direction: 'same',
          distanceMeters: 1200,
          lapTime: 140,
          lapPace: 2.3,
          isPr: false,
          visitCount: 8,
          historyTimes: [],
          historyActivityIds: [],
        },
      ],
      isLoading: false,
    });

    mockUseSectionOverlays.mockReturnValue({
      sectionOverlays: [
        {
          id: 'sec-65',
          sectionPolyline: [{ latitude: 1, longitude: 2 }],
          activityPortion: [{ latitude: 1, longitude: 2 }],
          overlayKey: 'sec-65|same',
          sortOrder: 0,
        },
        {
          id: 'sec-65',
          sectionPolyline: [{ latitude: 1, longitude: 2 }],
          activityPortion: [{ latitude: 1, longitude: 2 }],
          overlayKey: 'sec-65|reverse',
          sortOrder: 1,
        },
      ],
    });

    render(<ActivityDetailScreen />);
    await act(async () => {});

    const captureKeys = capturedSectionEncounters.map(
      (encounter) => `${encounter.sectionId}|${encounter.direction}`
    );
    expect(captureKeys).toEqual(['sec-65|same', 'sec-65|reverse']);
  });
});

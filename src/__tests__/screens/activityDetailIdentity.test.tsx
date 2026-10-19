/**
 * Scenario: the activity detail screen hands pre-computed bundles to its
 * section hooks. Built inline, a fresh object per render re-decoded every
 * matched polyline on every chart-scrub frame.
 *
 * Expected behaviour: a re-render with the same detail passes the same
 * `preComputed` objects to `useSectionMatches` and `useSectionOverlays`, so
 * the hooks' memoisation holds across a scrub.
 *
 * Scenario: the system text size is past the dense cap on a short window, and
 * the activity carries a long description.
 * Expected behaviour: the text above the tabs scrolls in a block bounded so it
 * leaves the tabs part of the window.
 * Below the cap the description stays pinned as it was. A long description
 * is clamped to three lines and opens in full on a press.
 */

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Section } from '@/types';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';
import type {
  PreComputedSectionMatches,
  SectionMatch,
  UseSectionMatchesResult,
} from '@/features/routes/hooks/useSectionMatches';
import { ActivityDetailCard } from '@/features/activity/components/ActivityDetailCard';
import { ActivityDetailMap } from '@/features/activity/components/ActivityDetailMap';
import {
  MapSheetHostContext,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';
import { EXPANDABLE_TEXT_LINES } from '@/shared/ui/ExpandableText';
import type { PreComputedOverlays } from '@/features/activity/hooks/useSectionOverlays';
import type { SectionEncounter } from 'veloqrs';
import { encodeTrack } from '../__shared__/trackBytes';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockWindow = { width: 360, height: 640, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockWindow,
}));

let mockSearchParams: { id: string; tab?: string } = { id: 'act-1' };
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
    useLocalSearchParams: () => mockSearchParams,
    router: { back: jest.fn(), push: jest.fn() },
    Stack,
  };
});

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/features/activity/components/ActivityDetailLoading', () => ({
  ActivityDetailLoading: ({ onPreviewSettled }: { onPreviewSettled?: () => void }) => {
    const React = require('react');
    React.useEffect(() => onPreviewSettled?.(), [onPreviewSettled]);
    return null;
  },
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));

const capturedTabs: { current: Record<string, unknown>[] } = {
  current: [],
};
jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    ScreenSafeAreaView: View,
    ChartSkeleton: () => null,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorState: () => null,
    useHeroMapHeight: () => 300,
    ExpandableText: jest.requireActual('@/shared/ui/ExpandableText').ExpandableText,
    SwipeableTabs: ({
      children,
      tabs,
    }: {
      children: React.ReactNode;
      tabs: Record<string, unknown>[];
    }) => {
      capturedTabs.current = tabs;
      return <>{children}</>;
    },
  };
});

const mockActivity: { description?: string; [key: string]: unknown } = {
  id: 'act-1',
  name: 'Morning Ride',
  sportType: 'Ride',
  startDateLocal: '2026-09-01T08:00:00',
  isDetail: true,
  movingTime: 0,
  distance: 0,
  elevationGain: 0,
  hasWeather: false,
  streamTypes: [],
};

// One array for the life of the test, because the real hook memoises on its
// sources and a fresh literal per render would fail the identity assertions
// below for a reason that has nothing to do with what they check.
const mockCoordinates = [
  { latitude: 1, longitude: 2 },
  { latitude: 3, longitude: 4 },
];

jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => ({ data: mockActivity, isLoading: false, error: null, refetch: jest.fn() }),
  useActivityStreams: (id: string) => {
    mockStreamReads.push(id);
    return {
      data: {
        latlng: [
          [1, 2],
          [3, 4],
        ],
      },
      isLoading: false,
    };
  },
  useActivityDetailStreams: () => ({
    data: {
      latlng: [
        [1, 2],
        [3, 4],
      ],
    },
    isLoading: false,
    coordinates: mockCoordinates,
  }),
  useActivityIntervals: () => ({ data: undefined }),
  useDetailCoordinates: () => {
    throw new Error('Detail coordinates must follow the composed stream read');
  },
  useActivitySectionHighlights: () => ({ routes: mockRouteHighlights, newGround: new Map() }),
  // The screen takes this through the feature barrel, which re-exports it from
  // this index, so the index has to hand back the same stub the module mock
  // below installs rather than one of its own.
  useSectionOverlays: (...args: unknown[]) =>
    (
      jest.requireMock('@/features/activity/hooks/useSectionOverlays') as {
        useSectionOverlays: (...a: unknown[]) => unknown;
      }
    ).useSectionOverlays(...args),
}));

const mockDetail: { encounters: SectionEncounter[]; [key: string]: unknown } = {
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
const mockStreamReads: string[] = [];
const mockRouteHighlights = new Map<
  string,
  { isPr: boolean; prImprovementSeconds?: number; timeDeltaSeconds?: number }
>();
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: () => ({ data: mockDetail }),
}));

const mockUseSectionMatches = jest.fn<
  UseSectionMatchesResult,
  [string | undefined, PreComputedSectionMatches]
>(() => ({
  sections: [],
  count: 0,
}));
jest.mock('@/features/routes/hooks/useSectionMatches', () => ({
  useSectionMatches: (activityId: string | undefined, bundle: PreComputedSectionMatches) =>
    mockUseSectionMatches(activityId, bundle),
}));
const mockUseSectionOverlays = jest.fn<
  { sectionOverlays: SectionOverlay[] | null },
  [
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
    activityId: string | undefined,
    engineSectionMatches: SectionMatch[],
    customMatchedSections: Section[],
    coordinates: { latitude: number; longitude: number }[],
    bundle: PreComputedOverlays,
    sectionEncounters?: SectionEncounter[]
  ) =>
    mockUseSectionOverlays(
      activityId,
      engineSectionMatches,
      customMatchedSections,
      coordinates,
      bundle,
      sectionEncounters
    ),
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
let mockRepresentativeId: string | null = null;
jest.mock('@/features/routes/hooks/useRouteMatch', () => ({
  useRouteMatch: () => ({ routeGroup: null, representativeActivityId: mockRepresentativeId }),
}));
jest.mock('@/features/activity/hooks/useActivitySectionHighlights', () => ({
  useActivitySectionHighlights: () => ({ routes: mockRouteHighlights, newGround: new Map() }),
}));
let mockRouteMatchingOn = true;
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: (sel: (s: { settings: { enabled: boolean } }) => unknown) =>
    sel({ settings: { enabled: mockRouteMatchingOn } }),
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

let capturedOnPointSelect: ((index: number | null) => void) | null = null;
let capturedTransitionSettled: boolean | null = null;
let capturedSectionEncounters: { sectionId: string; direction: string }[] = [];
jest.mock('@/features/activity/components/ActivityChartsSection', () => ({
  ActivityChartsSection: (props: {
    onPointSelect: (index: number | null) => void;
    transitionSettled: boolean;
  }) => {
    capturedOnPointSelect = props.onPointSelect;
    capturedTransitionSettled = props.transitionSettled;
    return null;
  },
}));
let capturedMapProps: {
  routeOverlay?: { latitude: number; longitude: number }[] | null;
  sectionOverlays?: SectionOverlay[] | null;
  onSectionMarkerPress?: (id: string) => void;
} = {};
jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ActivityMapView: (props: typeof capturedMapProps) => {
    capturedMapProps = props;
    return null;
  },
}));
let capturedRoutesProps: {
  routeImprovementSeconds?: number | null;
  routeGapSeconds?: number | null;
} = {};
jest.mock('@/features/activity/components/ActivityRoutesSection', () => ({
  ActivityRoutesSection: (props: typeof capturedRoutesProps) => {
    capturedRoutesProps = props;
    return null;
  },
}));
jest.mock('@/features/activity/components/ActivitySectionsSection', () => ({
  ActivitySectionsSection: (props: { encounters: { sectionId: string; direction: string }[] }) => {
    capturedSectionEncounters = props.encounters;
    return null;
  },
}));

/** The activity's card and its map, as the host's sheet and map screens draw them. */
function ActivityDetailScreen() {
  const { id, tab } = mockSearchParams;
  const key = useMapSheetHostEntry('activity', id);
  const host = React.useMemo<MapSheetHostValue>(
    () => ({
      kind: 'activity',
      id,
      key,
      focused: true,
      setHeaderOptions: (options: object) => {
        mockScreenOptions = { ...mockScreenOptions, ...(options as Record<string, unknown>) };
      },
    }),
    [id, key]
  );
  return (
    <MapSheetHostContext.Provider value={host}>
      <ActivityDetailCard id={id} tab={tab} />
      <ActivityDetailMap activityId={id} />
    </MapSheetHostContext.Provider>
  );
}

describe('activity detail screen', () => {
  beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    jest.clearAllMocks();
    capturedSectionEncounters = [];
    capturedTabs.current = [];
    capturedMapProps = {};
    capturedRoutesProps = {};
    mockRouteMatchingOn = true;
    capturedOnPointSelect = null;
    capturedTransitionSettled = null;
    mockUseSectionOverlays.mockReset();
    mockUseSectionOverlays.mockImplementation(() => ({ sectionOverlays: [] }));
    mockDetail.encounters = [];
    delete mockDetail.representativeSignature;
    mockRouteHighlights.clear();
    mockStreamReads.length = 0;
    mockSearchParams = { id: 'act-1' };
    mockRepresentativeId = null;
    mockScreenOptions = {};
    delete mockActivity.description;
    mockWindow.fontScale = 1;
  });
  afterEach(() => jest.restoreAllMocks());

  it("titles its navigation item with the activity's name once the read has it", async () => {
    await render(<ActivityDetailScreen />);
    await act(async () => {});
    expect(mockScreenOptions.title).toBe('Morning Ride');
  });

  it('clamps a long description to three lines and opens it in full on Show more', async () => {
    const description = Array.from(
      { length: 12 },
      (_, line) => `Line ${line + 1} of the harbour loop notes.`
    ).join('\n');
    mockActivity.description = description;

    const view = await render(<ActivityDetailScreen />);
    await act(async () => {});
    await fireEvent(
      view.getByTestId('activity-description-measure', { includeHiddenElements: true }),
      'textLayout',
      { nativeEvent: { lines: description.split('\n').map((text) => ({ text })) } }
    );

    expect(view.getByText(description).props.numberOfLines).toBe(EXPANDABLE_TEXT_LINES);
    expect(view.getByText(description).props.accessibilityLabel).toBe(description);

    await fireEvent.press(view.getByTestId('activity-description-toggle'));

    expect(view.getByText(description).props.numberOfLines).toBeUndefined();
  });

  it('past the dense cap scrolls the text above the tabs in a block that leaves them room', async () => {
    const description = Array.from(
      { length: 40 },
      (_, line) => `Line ${line + 1} of the harbour loop notes.`
    ).join('\n');
    mockActivity.description = description;
    mockWindow.fontScale = 2;

    const view = await render(<ActivityDetailScreen />);
    await act(async () => {});

    const block = view.getByTestId('activity-detail-pinned-scroll');
    expect(within(block).getByText(description)).toBeTruthy();
    const { maxHeight } = StyleSheet.flatten(block.props.style);
    expect(typeof maxHeight).toBe('number');
    expect(maxHeight as number).toBeLessThan(mockWindow.height * 0.75);
  });

  it('below the dense cap keeps the description pinned above the tabs', async () => {
    mockActivity.description = 'Harbour loop, light wind.';

    const view = await render(<ActivityDetailScreen />);
    await act(async () => {});

    expect(view.getByText('Harbour loop, light wind.')).toBeTruthy();
    expect(view.queryByTestId('activity-detail-pinned-scroll')).toBeNull();
  });

  it('keeps a route record off the Routes tab and hands its improvement to the page', async () => {
    mockSearchParams = { id: 'act-1', tab: 'routes' };
    mockRouteHighlights.set('act-1', { isPr: true, prImprovementSeconds: 65, timeDeltaSeconds: 0 });
    await render(<ActivityDetailScreen />);
    await act(async () => {});

    const routesTab = capturedTabs.current.find((tab) => tab.key === 'routes');
    expect(Object.keys(routesTab ?? {}).sort()).toStrictEqual(['icon', 'key', 'label']);
    expect(capturedRoutesProps.routeImprovementSeconds).toBe(65);
  });

  it('keeps a slower route time off the Routes tab and hands its gap to the page', async () => {
    mockSearchParams = { id: 'act-1', tab: 'routes' };
    mockRouteHighlights.set('act-1', { isPr: false, timeDeltaSeconds: 95 });
    await render(<ActivityDetailScreen />);
    await act(async () => {});

    const routesTab = capturedTabs.current.find((tab) => tab.key === 'routes');
    expect(Object.keys(routesTab ?? {}).sort()).toStrictEqual(['icon', 'key', 'label']);
    expect(capturedRoutesProps.routeImprovementSeconds).toBeNull();
    expect(capturedRoutesProps.routeGapSeconds).toBe(95);
  });

  it("draws the Routes tab overlay from the detail read's signature, reading no representative streams", async () => {
    const signature = [
      { latitude: 46.5, longitude: 6.6 },
      { latitude: 46.502, longitude: 6.604 },
    ];
    mockSearchParams = { id: 'act-1', tab: 'routes' };
    mockRepresentativeId = 'rep-1';
    mockDetail.representativeSignature = encodeTrack(signature);

    await render(<ActivityDetailScreen />);
    await act(async () => {});

    expect(mockStreamReads).not.toContain('rep-1');
    const overlay = capturedMapProps.routeOverlay;
    expect(overlay).toHaveLength(2);
    expect(overlay?.[1].latitude).toBeCloseTo(46.502, 6);
    expect(overlay?.[1].longitude).toBeCloseTo(6.604, 6);
  });

  it('hands the charts a settled transition in the sheet, which opens once the push has ended', async () => {
    await render(<ActivityDetailScreen />);
    await act(async () => {});
    expect(capturedTransitionSettled).toBe(true);
  });

  it('keeps the pre-computed bundles it hands its hooks stable across a scrub', async () => {
    await render(<ActivityDetailScreen />);
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

  it("hands the overlay hook the engine's encounter order, forward and reverse kept distinct", async () => {
    mockDetail.encounters = [
      {
        sectionId: 'sec-65',
        sectionType: 'auto',
        sectionName: 'Section 65',
        direction: 'same',
        distanceMeters: 1200,
        startIndex: 0,
        lapTime: 140,
        lapPace: 2.3,
        isPr: false,
        isComplete: true,
        visitCount: 8,
        historyTimes: [],
        historyActivityIds: [],
        historyDates: [],
      },
      {
        sectionId: 'sec-65',
        sectionType: 'auto',
        sectionName: 'Section 65',
        direction: 'reverse',
        distanceMeters: 900,
        startIndex: 0,
        lapTime: 120,
        lapPace: 2.1,
        isPr: false,
        isComplete: true,
        visitCount: 5,
        historyTimes: [],
        historyActivityIds: [],
        historyDates: [],
      },
    ];

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

    await render(<ActivityDetailScreen />);
    await act(async () => {});

    const captureKeys = capturedSectionEncounters.map(
      (encounter) => `${encounter.sectionId}|${encounter.direction}`
    );
    expect(captureKeys).toEqual(['sec-65|same', 'sec-65|reverse']);
  });

  it('counts the Sections tab by section, so a both-ways crossing is one', async () => {
    mockDetail.encounters = [
      {
        sectionId: 'sec-65',
        sectionType: 'auto',
        sectionName: 'Section 65',
        direction: 'same',
        distanceMeters: 1200,
        startIndex: 0,
        lapTime: 140,
        lapPace: 2.3,
        isPr: false,
        isComplete: true,
        visitCount: 8,
        historyTimes: [],
        historyActivityIds: [],
        historyDates: [],
      },
      {
        sectionId: 'sec-65',
        sectionType: 'auto',
        sectionName: 'Section 65',
        direction: 'reverse',
        distanceMeters: 900,
        startIndex: 0,
        lapTime: 120,
        lapPace: 2.1,
        isPr: false,
        isComplete: true,
        visitCount: 5,
        historyTimes: [],
        historyActivityIds: [],
        historyDates: [],
      },
      {
        sectionId: 'sec-66',
        sectionType: 'auto',
        sectionName: 'Section 66',
        direction: 'same',
        distanceMeters: 400,
        startIndex: 0,
        lapTime: 60,
        lapPace: 1.9,
        isPr: false,
        isComplete: true,
        visitCount: 2,
        historyTimes: [],
        historyActivityIds: [],
        historyDates: [],
      },
    ];

    await render(<ActivityDetailScreen />);
    await act(async () => {});

    const sectionsTab = capturedTabs.current.find((tab) => tab.key === 'sections');
    expect(sectionsTab?.count).toBe(2);
  });

  it('draws no section overlay and offers no Sections tab with route matching off', async () => {
    mockRouteMatchingOn = false;
    mockUseSectionOverlays.mockReturnValue({
      sectionOverlays: [
        {
          id: 'sec-1',
          sectionPolyline: [{ latitude: 1, longitude: 2 }],
          activityPortion: [{ latitude: 1, longitude: 2 }],
          overlayKey: 'sec-1|same',
          sortOrder: 0,
        },
      ],
    });

    await render(<ActivityDetailScreen />);
    await act(async () => {});

    expect(capturedMapProps.sectionOverlays ?? null).toBeNull();
    expect(capturedMapProps.onSectionMarkerPress).toBeUndefined();
    expect(capturedTabs.current.map((tab) => tab.key)).not.toContain('sections');
  });
});

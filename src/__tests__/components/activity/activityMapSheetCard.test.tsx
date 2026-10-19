/**
 * Scenario: an activity with a track opens as a full map under the shared map sheet, its card in
 * the sheet and its map under it, and the two share the tab on show, the chart's scrub point, the
 * section a marker asks for and the section-drawing tool through the host's entry.
 *
 * Expected behaviour: the sheet holds the activity's card, with the name, the distance, the moving
 * time and the climb at Peek, then the tab strip and the first page. A scrub reaches the map and
 * not the card, the Routes tab takes the section lines off the map, a marker tap opens the
 * Sections tab on its section, and starting a section puts the sheet away for the tool. An
 * activity opened from a row in another subject's sheet arrives as a card in that sheet. A stop
 * move presents the sheet again, which mounts its card afresh, and the card keeps the tab it was on.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { DetailCardStack } from '@/features/routes/screens/DetailCardStack';
import { DetailMapHost } from '@/features/routes/components/DetailMapHost';
import {
  MapSheetHostContext,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';
import {
  mapSheetHostKey,
  pushHostCard,
  type MapSheetKind,
  useMapSheetHosts,
} from '@/shared/app/mapSheetHost';
import { useMapSheetStop, useMapSheetStops } from '@/shared/app/mapSheetStop';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => true,
}));
// The route's own card and map stand aside for the activity card pushed over them.
jest.mock('@/features/routes/screens/RouteDetailCard', () => ({ RouteDetailCard: () => null }));
jest.mock('@/features/routes/components/RouteDetailMap', () => ({ RouteDetailMap: () => null }));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));

const mockActivity = {
  id: 'act-7',
  name: 'Lighthouse loop',
  sportType: 'Ride',
  startDateLocal: '2026-09-01T08:00:00',
  isDetail: true,
  movingTime: 3753,
  distance: 12300,
  elevationGain: 245,
  hasWeather: false,
  streamTypes: ['latlng', 'altitude'],
};
const mockCoordinates = [
  { latitude: 46.5, longitude: 6.6 },
  { latitude: 46.51, longitude: 6.61 },
];
jest.mock('@/features/activity/hooks', () => ({
  useActivity: () => ({ data: mockActivity, isLoading: false, error: null, refetch: jest.fn() }),
  useActivityDetailStreams: () => ({
    data: undefined,
    isLoading: false,
    isDownloaded: true,
    coordinates: mockCoordinates,
  }),
  useActivityIntervals: () => ({ data: undefined }),
  useActivitySectionHighlights: () => ({ routes: new Map(), newGround: new Map() }),
  useSectionOverlays: () => ({ sectionOverlays: mockOverlays }),
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
  hasGpsTrack: true,
  representativeSignature: new ArrayBuffer(0),
};
jest.mock('@/features/activity/hooks/useActivityDetailData', () => ({
  useActivityDetailData: () => ({ data: mockDetail }),
}));
const point = { latitude: 46.5, longitude: 6.6 };
const mockOverlays: SectionOverlay[] = [
  { id: 'sec-1', sectionPolyline: [point, point], activityPortion: [point, point] },
];
jest.mock('@/features/routes/hooks/useActivityRematch', () => ({
  useActivityRematch: () => ({ matches: [], scan: jest.fn(), rematch: jest.fn() }),
}));
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ createSection: jest.fn(), removeSection: jest.fn(), sections: [] }),
}));
jest.mock('@/features/routes/hooks/useRouteMatch', () => ({
  useRouteMatch: () => ({ routeGroup: null, representativeActivityId: null }),
}));
jest.mock('@/features/routes/hooks/useSectionMatches', () => ({
  useSectionMatches: () => ({ sections: [], count: 0 }),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: (sel: (s: { settings: { enabled: boolean } }) => unknown) =>
    sel({ settings: { enabled: true } }),
}));
jest.mock('@/features/settings/stores/DebugStore', () => ({
  useDebugStore: (sel: (s: { enabled: boolean }) => unknown) => sel({ enabled: false }),
}));
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/features/wellness', () => ({ useWellnessForDate: () => ({ data: undefined }) }));
jest.mock('@/features/strength', () => ({
  useExerciseSets: () => ({ data: undefined }),
  ExerciseTable: () => null,
  MuscleGroupView: () => null,
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getTerrain3DMode: () => 'off',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    getActivityOverride: () => undefined,
    captureActivityCamera: jest.fn(),
    restoreActivityCamera: jest.fn(),
  }),
}));

let mockChartsRenders = 0;
let mockOnPointSelect: ((index: number | null) => void) | null = null;
jest.mock('@/features/activity/components/ActivityChartsSection', () => ({
  ActivityChartsSection: (props: { onPointSelect: (index: number | null) => void }) => {
    const { Text } = require('react-native');
    mockChartsRenders += 1;
    mockOnPointSelect = props.onPointSelect;
    return <Text testID="charts-page">charts</Text>;
  },
}));
jest.mock('@/features/activity/components/ActivityRoutesSection', () => ({
  ActivityRoutesSection: () => null,
}));
let mockSectionsProps: {
  focusSectionId?: string | null;
  onSectionCreationModeChange?: (mode: boolean) => void;
} = {};
jest.mock('@/features/activity/components/ActivitySectionsSection', () => ({
  ActivitySectionsSection: (props: typeof mockSectionsProps) => {
    mockSectionsProps = props;
    return null;
  },
}));
let mockMapProps: {
  highlightIndex?: number | null;
  sectionOverlays?: SectionOverlay[] | null;
  creationMode?: boolean;
  onSectionMarkerPress?: (id: string) => void;
} = {};
jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ...jest.requireActual('@/features/maps/components/ActivityMapView'),
  ActivityMapView: (props: typeof mockMapProps) => {
    mockMapProps = props;
    return null;
  },
}));

function InHost({ kind, id }: { kind: MapSheetKind; id: string }) {
  const key = useMapSheetHostEntry(kind, id);
  const host = useMemo<MapSheetHostValue>(
    () => ({ kind, id, key, focused: true, setHeaderOptions: () => {} }),
    [kind, id, key]
  );
  return (
    <MapSheetHostContext.Provider value={host}>
      <DetailCardStack rootParams={{}} />
      <DetailMapHost rootParams={{}} />
    </MapSheetHostContext.Provider>
  );
}

/**
 * A host whose sheet is presented again on every stop move, as the map screen's presenter pops the
 * sheet screen and pushes it at the new stop, so the card stack mounts afresh each time.
 */
let mockTapHandle: (() => void) | null = null;
function InRepresentingHost({ kind, id }: { kind: MapSheetKind; id: string }) {
  const key = useMapSheetHostEntry(kind, id);
  const host = useMemo<MapSheetHostValue>(
    () => ({ kind, id, key, focused: true, setHeaderOptions: () => {} }),
    [kind, id, key]
  );
  const [presented, setPresented] = useState(0);
  const present = useCallback((stop: number | null) => {
    if (stop !== null) setPresented((count) => count + 1);
  }, []);
  const { tapHandle } = useMapSheetStop(key, present);
  useEffect(() => {
    mockTapHandle = tapHandle;
  }, [tapHandle]);
  return (
    <MapSheetHostContext.Provider value={host}>
      <DetailCardStack key={presented} rootParams={{}} />
      <DetailMapHost rootParams={{}} />
    </MapSheetHostContext.Provider>
  );
}

const ACTIVITY_HOST = mapSheetHostKey('activity', 'act-7');

beforeEach(() => {
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
  mockChartsRenders = 0;
  mockOnPointSelect = null;
  mockSectionsProps = {};
  mockMapProps = {};
  mockTapHandle = null;
});

describe("an activity's map sheet", () => {
  it('holds the card with the name, distance, moving time and climb at Peek, then the tabs', async () => {
    await render(<InHost kind="activity" id="act-7" />);

    const peek = screen.getByTestId('activity-card-peek');
    expect(screen.getByText('Lighthouse loop')).toBeTruthy();
    expect(screen.getByTestId('activity-detail-stats').props.accessibilityLabel).toBe(
      'activity.distance: 12.3 km, activity.duration: 1:02:33, sections.elevationGain: 245 m'
    );
    expect(peek).toBeTruthy();
    expect(screen.getByTestId('tab-charts')).toBeTruthy();
    expect(screen.getByTestId('tab-sections')).toBeTruthy();
    expect(screen.getByTestId('charts-page')).toBeTruthy();
  });

  it('hands a chart scrub to the map without rendering the card', async () => {
    await render(<InHost kind="activity" id="act-7" />);
    const chartsBefore = mockChartsRenders;

    await act(async () => mockOnPointSelect?.(12));

    expect(mockMapProps.highlightIndex).toBe(12);
    expect(mockChartsRenders).toBe(chartsBefore);
  });

  it('takes the section lines off the map on the Routes tab', async () => {
    await render(<InHost kind="activity" id="act-7" />);
    expect(mockMapProps.sectionOverlays).toBe(mockOverlays);

    await fireEvent.press(screen.getByTestId('tab-routes'));

    expect(mockMapProps.sectionOverlays).toBeNull();
  });

  it("opens the Sections tab on a marker's section", async () => {
    await render(<InHost kind="activity" id="act-7" />);

    await act(async () => mockMapProps.onSectionMarkerPress?.('sec-1'));

    expect(mockSectionsProps.focusSectionId).toBe('sec-1');
    expect(screen.getByTestId('tab-sections').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('puts the sheet away while a section is drawn on the map', async () => {
    await render(<InHost kind="activity" id="act-7" />);
    await fireEvent.press(screen.getByTestId('tab-sections'));

    await act(async () => mockSectionsProps.onSectionCreationModeChange?.(true));
    expect(mockMapProps.creationMode).toBe(true);
    expect(useMapSheetStops.getState().sheets[ACTIVITY_HOST]?.toolReturn).not.toBeNull();

    await act(async () => mockSectionsProps.onSectionCreationModeChange?.(false));
    expect(mockMapProps.creationMode).toBe(false);
  });

  it("arrives as a card in another subject's sheet", async () => {
    await render(<InHost kind="route" id="route-3" />);

    await act(async () =>
      pushHostCard(mapSheetHostKey('route', 'route-3'), { kind: 'activity', id: 'act-7' })
    );

    expect(screen.getByTestId('activity-card-peek')).toBeTruthy();
    expect(mockMapProps.highlightIndex).toBeNull();
  });

  it('keeps the tab on show when a handle tap presents the sheet again', async () => {
    await render(<InRepresentingHost kind="activity" id="act-7" />);
    await fireEvent.press(screen.getByTestId('tab-routes'));

    await act(async () => mockTapHandle?.());
    expect(useMapSheetStops.getState().sheets[ACTIVITY_HOST]?.stop).toBe(2);

    expect(screen.getByTestId('tab-routes').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('tab-charts').props.accessibilityState).toEqual({ selected: false });
    expect(mockMapProps.sectionOverlays).toBeNull();
  });

  it('opens a card pushed afresh on the tab its link names, not on a tab another card kept', async () => {
    await render(<InRepresentingHost kind="route" id="route-3" />);
    const routeHost = mapSheetHostKey('route', 'route-3');
    await act(async () =>
      pushHostCard(routeHost, { kind: 'activity', id: 'act-7', params: { tab: 'sections' } })
    );
    expect(screen.getByTestId('tab-sections').props.accessibilityState).toEqual({
      selected: true,
    });

    await fireEvent.press(screen.getByTestId('tab-charts'));
    await act(async () => mockTapHandle?.());

    expect(screen.getByTestId('tab-charts').props.accessibilityState).toEqual({ selected: true });
  });
});

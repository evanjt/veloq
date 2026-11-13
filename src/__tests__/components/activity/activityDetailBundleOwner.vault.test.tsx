/**
 * Scenario: an activity card and the map under it are open for one activity.
 *
 * Expected behaviour: one engine bundle read serves both, at open and again on each body landing.
 */

import React, { useMemo } from 'react';
import { act, render } from '@testing-library/react-native';

import { DetailCardStack } from '@/features/routes/screens/DetailCardStack';
import { DetailMapHost } from '@/features/routes/components/DetailMapHost';
import {
  MapSheetHostContext,
  useMapSheetHostEntry,
  type MapSheetHostValue,
} from '@/shared/app/MapSheetHost';
import { useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined, isLoading: false }),
}));
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

jest.mock('@/features/activity/components/ActivityChartsSection', () => ({
  ActivityChartsSection: () => {
    const { Text } = require('react-native');
    return <Text testID="charts-page">charts</Text>;
  },
}));
jest.mock('@/features/activity/components/ActivityRoutesSection', () => ({
  ActivityRoutesSection: () => null,
}));
jest.mock('@/features/activity/components/ActivitySectionsSection', () => ({
  ActivitySectionsSection: () => null,
}));
jest.mock('@/features/maps/components/ActivityMapView', () => ({
  ...jest.requireActual('@/features/maps/components/ActivityMapView'),
  ActivityMapView: () => null,
}));

const mockBundle = {
  matchedSections: [],
  sectionCount: 0,
  sectionTraces: [],
  prSectionIds: [],
  customSections: [],
  encounters: [],
  highlights: { indicators: [], routeHighlights: [], newGround: [], strengthCards: [] },
  routeGroups: [],
  activityCount: 1,
  hasGpsTrack: true,
  representativeSignature: new ArrayBuffer(0),
};
const mockListeners: Record<string, ((payload: unknown) => void)[]> = {};
const mockRead = jest.fn(() => mockBundle);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getActivityDetailData: () => mockRead(),
    subscribe: (event: string, fn: (payload: unknown) => void) => {
      (mockListeners[event] ??= []).push(fn);
      return () => {
        mockListeners[event] = (mockListeners[event] ?? []).filter((f) => f !== fn);
      };
    },
  }),
}));

function InHost({ id }: { id: string }) {
  const key = useMapSheetHostEntry('activity', id);
  const host = useMemo<MapSheetHostValue>(
    () => ({ kind: 'activity', id, key, focused: true, setHeaderOptions: () => {} }),
    [id, key]
  );
  return (
    <MapSheetHostContext.Provider value={host}>
      <DetailCardStack rootParams={{}} />
      <DetailMapHost rootParams={{}} />
    </MapSheetHostContext.Provider>
  );
}

beforeEach(() => {
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
  mockRead.mockClear();
});

describe('the activity detail bundle read', () => {
  it('runs once for the card and the map together, and once per body landing', async () => {
    await render(<InHost id="act-7" />);
    expect(mockRead).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const fn of mockListeners.bodyStored ?? []) {
        fn({ kind: 'activity_detail', activityId: 'act-7' });
      }
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});

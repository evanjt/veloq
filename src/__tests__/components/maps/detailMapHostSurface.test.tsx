/**
 * Scenario: a detail host shows a route card, the athlete pans its map, and a section card is
 * pushed onto the sheet above it, then popped.
 *
 * Expected behaviour: one map page serves both cards. Pushing the section swaps the route's lines
 * for the section's on the same page and moves the camera once, onto the section's extent; popping
 * puts the route's lines back and returns the camera to where the athlete left the route.
 */

import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DetailMapHost } from '@/features/routes/components/DetailMapHost';
import { MapSheetHostContext, type MapSheetHostValue } from '@/shared/app/MapSheetHost';
import { openHost, popHostCard, pushHostCard, useMapSheetHosts } from '@/shared/app/mapSheetHost';
import type { FrequentSection, RoutePoint } from '@/types';

type Patch = { patch: { sources?: Record<string, unknown>; layers?: { id: string }[] } | null };
type Message = (event: { nativeEvent: { data: string } }) => void;

const mockPatches: Patch[] = [];
const mockScripts: string[] = [];
const mockPage: { mounts: number; onMessage: Message | null } = { mounts: 0, onMessage: null };

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: Message },
  ref: React.Ref<unknown>
) {
  mockPage.onMessage = props.onMessage;
  React.useEffect(() => {
    mockPage.mounts += 1;
  }, []);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => mockScripts.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('@/features/maps/lib/mapSurfacePatch', () => {
  const actual = jest.requireActual('@/features/maps/lib/mapSurfacePatch');
  return {
    ...actual,
    createSurfacePatcher: () => {
      const patcher = actual.createSurfacePatcher();
      return {
        ...patcher,
        next: (specs: unknown) => {
          const result = patcher.next(specs);
          mockPatches.push(result);
          return result;
        },
      };
    },
  };
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const line = (lat: number, lng: number): RoutePoint[] =>
  Array.from({ length: 8 }, (_, i) => ({ lat: lat + i * 0.001, lng: lng + i * 0.001 }));

const mockOrchard = {
  id: 'orchard-loop',
  name: 'Orchard loop',
  signature: { points: line(45.1, 6.1), distance: 4200 },
  activityIds: ['pick-1', 'pick-2'],
  activityCount: 2,
  type: 'Ride' as const,
};
const mockOrchardTraces = {
  'pick-1': { points: line(45.1, 6.1) },
  'pick-2': { points: line(45.1001, 6.1) },
};
const mockBarnLane = {
  id: 'barn-lane',
  sectionType: 'auto',
  name: 'Barn lane',
  sportTypes: ['Ride'],
  polyline: line(46.948, 7.447),
  distanceMeters: 900,
  activityIds: ['pick-1'],
  visitCount: 1,
  createdAt: '2026-01-15T10:00:00Z',
} as FrequentSection;

// The views drawn from fixtures in place of the engine reads their detail maps make.
jest.mock('@/features/routes/components/RouteDetailMap', () => ({
  RouteDetailMap: () => {
    const { RouteMapView } = jest.requireActual('@/features/routes/components/RouteMapView');
    return (
      <RouteMapView
        routeGroup={mockOrchard}
        activitySignatures={mockOrchardTraces}
        height={844}
        interactive
      />
    );
  },
}));
jest.mock('@/features/routes/components/SectionDetailMap', () => ({
  SectionDetailMap: () => {
    const { SectionMapView } = jest.requireActual('@/features/routes/components/SectionMapView');
    return <SectionMapView section={mockBarnLane} height={844} interactive />;
  },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const HOST: MapSheetHostValue = {
  kind: 'route',
  id: 'orchard-loop',
  key: 'route:orchard-loop',
  focused: true,
  setHeaderOptions: () => {},
};

function pushBarnLane() {
  act(() => pushHostCard(HOST.key, { kind: 'section', id: 'barn-lane' }));
}

function popCard() {
  act(() => popHostCard(HOST.key));
}

async function send(message: object) {
  const onMessage = mockPage.onMessage;
  if (!onMessage) throw new Error('no map page is mounted');
  await act(() => onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
}

/** The ids of the layers the page was last sent. */
function lastLayerIds(): string[] {
  const sent = mockPatches.filter((entry) => entry.patch?.layers).at(-1);
  return sent?.patch?.layers?.map((layer) => layer.id) ?? [];
}

/** The extents the camera was fitted to by the scripts sent from `from` on. */
function fitsSince(from: number): [number, number][][] {
  return mockScripts
    .slice(from)
    .map((script) => /fitBounds\((\[\[.*?\]\])/.exec(script)?.[1])
    .filter((found): found is string => !!found)
    .map((found) => JSON.parse(found));
}

async function openOrchard() {
  openHost('route', 'orchard-loop');
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MapSheetHostContext.Provider value={HOST}>
        <DetailMapHost rootParams={{}} />
      </MapSheetHostContext.Provider>
    </SafeAreaProvider>
  );
  await send({ type: 'mapReady' });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPatches.length = 0;
  mockScripts.length = 0;
  mockPage.mounts = 0;
  mockPage.onMessage = null;
  useMapSheetHosts.setState({ hosts: {} });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a detail host’s one map', () => {
  it('draws the route card on one page', async () => {
    await openOrchard();

    expect(mockPage.mounts).toBe(1);
    expect(lastLayerIds()).toContain('route-line');
  });

  it('swaps to a pushed section on the same page and fits its extent once', async () => {
    await openOrchard();
    const before = mockScripts.length;

    pushBarnLane();

    expect(mockPage.mounts).toBe(1);
    expect(lastLayerIds()).toContain('section-line');
    expect(lastLayerIds()).not.toContain('route-line');
    const swap = mockPatches.find((entry) => entry.patch?.sources?.route === null);
    expect(swap?.patch?.sources?.section).toBeDefined();

    const fits = fitsSince(before);
    expect(fits).toHaveLength(1);
    const [[swLng, swLat], [neLng, neLat]] = fits[0];
    // The section's points span 7.447 to 7.454 and 46.948 to 46.955, with 15 % room each side.
    expect(swLng).toBeCloseTo(7.44595, 5);
    expect(swLat).toBeCloseTo(46.94695, 5);
    expect(neLng).toBeCloseTo(7.45505, 5);
    expect(neLat).toBeCloseTo(46.95605, 5);
  });

  it('puts the route back where the athlete left it when the section is popped', async () => {
    await openOrchard();
    await send({
      type: 'regionDidChange',
      center: [6.1042, 45.1037],
      zoom: 15.25,
      bearing: 12,
      pitch: 0,
      bounds: { sw: [6.1, 45.1], ne: [6.11, 45.11] },
      isUserInteraction: true,
    });
    pushBarnLane();
    const beforePop = mockScripts.length;

    popCard();

    expect(mockPage.mounts).toBe(1);
    expect(lastLayerIds()).toContain('route-line');
    expect(lastLayerIds()).not.toContain('section-line');
    const moves = mockScripts.slice(beforePop).filter((script) => /easeTo|jumpTo/.test(script));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toContain('"center":[6.1042,45.1037]');
    expect(moves[0]).toContain('"zoom":15.25');
    expect(fitsSince(beforePop)).toHaveLength(0);
  });
});

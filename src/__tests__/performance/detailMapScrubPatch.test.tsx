/**
 * Scenario: the athlete scrubs the performance chart on section detail and on
 * route detail, so each new index hands the hero map a new highlighted
 * activity while every other trace stays where it was.
 *
 * Expected behaviour: a scrub tick costs the same with 50 traversals as with
 * 200. Section detail moves the highlight by layer filter alone and sends no
 * source; route detail sends only the one highlighted attempt and its two
 * endpoint dots. Every number here is a count or a length, so a busy machine
 * cannot move it.
 *
 * An activity detail map mounting a six-hour ride sends the track once, not
 * once per layer drawing it.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';
import type { FrequentSection, RoutePoint } from '@/types';

type Tick = { serialised: number; script: number; changed: string[] };

const mockTicks: Tick[] = [];
const mockPages = new Map<string, (event: { nativeEvent: { data: string } }) => void>();
const mockInjected: string[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { testID?: string; onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<unknown>
) {
  mockPages.set(props.testID ?? 'webview', props.onMessage);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => mockInjected.push(script),
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
      const { buildApplyScript } = jest.requireActual('@/features/maps/lib/htmlBuilders');
      const patcher = actual.createSurfacePatcher();
      return {
        ...patcher,
        next: (specs: Parameters<typeof patcher.next>[0]) => {
          const result = patcher.next(specs);
          mockTicks.push({
            serialised: result.serialised,
            script: result.patch ? buildApplyScript(result.patch).length : 0,
            changed: result.patch?.sources ? Object.keys(result.patch.sources) : [],
          });
          return result;
        },
      };
    },
  };
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const POINTS_PER_TRACE = 200;
const TRAVERSALS = [50, 200];
const SCRUB_TICKS = 20;

function trace(seed: number): RoutePoint[] {
  return Array.from({ length: POINTS_PER_TRACE }, (_, i) => ({
    lat: 46.948 + i * 0.0001 + seed * 0.000001,
    lng: 7.447 + i * 0.0001 - seed * 0.000001,
  }));
}

function traces(count: number): Record<string, RoutePoint[]> {
  const out: Record<string, RoutePoint[]> = {};
  for (let i = 0; i < count; i++) out[`act-${i}`] = trace(i);
  return out;
}

function ready() {
  for (const onMessage of mockPages.values()) {
    act(() => onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
  }
}

type TickCeiling = {
  /** Specs the patcher may serialise in one tick. */
  serialised: number;
  /** Sources a tick may send. Everything else on the map stays where it was. */
  sources: string[];
  /** Characters of injected script per tick, icons and layers included. */
  script: number;
};

// Section detail moves the highlight by the faded layer's filter, so a tick is
// the layer list and nothing else: measured 3,049 characters. The list goes
// whole because the page takes its order from it.
const SECTION_TICK: TickCeiling = { serialised: 1, sources: [], script: 3_600 };

// Route detail draws the highlighted attempt from its own source so the faded
// collection never changes, which costs one attempt and its endpoints per
// tick: measured 7,685 characters at 200 points.
const ROUTE_TICK: TickCeiling = {
  serialised: 3,
  sources: ['endpoints', 'highlighted-trace'],
  script: 9_200,
};

function expectScrubTicks(ticks: Tick[], ceiling: TickCeiling) {
  expect(ticks).toHaveLength(SCRUB_TICKS);
  for (const tick of ticks) {
    expect(tick.serialised).toBeLessThanOrEqual(ceiling.serialised);
    expect(tick.changed.filter((id) => !ceiling.sources.includes(id))).toEqual([]);
    expect(tick.script).toBeLessThanOrEqual(ceiling.script);
  }
}

beforeEach(() => {
  mockTicks.length = 0;
  mockInjected.length = 0;
  mockPages.clear();
});

describe('activity detail map mount', () => {
  // A six-hour ride recorded at one point a second.
  const SIX_HOURS = 21_600;
  const coordinates: LatLng[] = Array.from({ length: SIX_HOURS }, (_, i) => ({
    latitude: 46.948 + Math.sin(i / 500) * 0.05,
    longitude: 7.447 + (i / SIX_HOURS) * 0.4,
  }));

  it('sends the track once', () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActivityMapView activityType="Ride" coordinates={coordinates} activeTab="charts" />
      </SafeAreaProvider>
    );
    ready();

    const applies = mockInjected.filter((s) => s.includes('window._veloq.apply('));
    expect(applies).toHaveLength(1);
    const mount = applies[0];
    const patch = JSON.parse(mount.slice(mount.indexOf('(') + 1, mount.lastIndexOf(')')));
    const trackChars = JSON.stringify(patch.sources.route.data).length;
    expect(trackChars).toBeGreaterThan(SIX_HOURS * 10);
    expect(mount.length).toBeLessThan(trackChars * 1.1);
  });
});

describe.each(TRAVERSALS)('scrub cost with %i traversals', (count) => {
  const all = traces(count);
  const ids = Object.keys(all);

  it('section detail map', () => {
    const section: FrequentSection = {
      id: 'section-1',
      sectionType: 'auto',
      name: 'Hill',
      sportTypes: ['Ride'],
      polyline: trace(0),
      distanceMeters: 2000,
      activityIds: ids,
      activityTraces: all,
      visitCount: count,
      createdAt: '2026-01-15T10:00:00Z',
    } as FrequentSection;
    const map = (highlightedActivityId: string | null) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <SectionMapView
          section={section}
          interactive
          enableFullscreen
          allActivityTraces={all}
          highlightedActivityId={highlightedActivityId}
        />
      </SafeAreaProvider>
    );
    const view = render(map(null));
    ready();
    mockTicks.length = 0;
    for (let i = 0; i < SCRUB_TICKS; i++) view.rerender(map(ids[i % ids.length]));
    expectScrubTicks(mockTicks, SECTION_TICK);
  });

  it('route detail map', () => {
    const signatures: Record<string, { points: RoutePoint[] }> = {};
    for (const id of ids) signatures[id] = { points: all[id] };
    const routeGroup = {
      id: 'route-1',
      name: 'Loop',
      activityIds: ids,
      activityCount: count,
      sportType: 'Ride',
      signature: { points: trace(0), distance: 2000 },
    } as unknown as React.ComponentProps<typeof RouteMapView>['routeGroup'];
    const map = (highlightedActivityId: string | null) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <RouteMapView
          routeGroup={routeGroup}
          interactive
          enableFullscreen
          activitySignatures={signatures}
          highlightedActivityId={highlightedActivityId}
        />
      </SafeAreaProvider>
    );
    const view = render(map(null));
    ready();
    mockTicks.length = 0;
    for (let i = 0; i < SCRUB_TICKS; i++) view.rerender(map(ids[i % ids.length]));
    expectScrubTicks(mockTicks, ROUTE_TICK);
  });
});

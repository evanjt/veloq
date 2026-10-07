/**
 * Scenario: the athlete scrubs the performance chart on section detail and on
 * route detail, so each new index hands the hero map a new highlighted
 * activity while every other trace stays where it was.
 *
 * Measures, per scrub tick, how many map sources the surface patcher
 * serialises, how many bytes that is, and how long the patch takes on this
 * machine. Only the highlight moves, so every source past the highlighted ones
 * is work the gesture pays for and throws away.
 *
 * Collected only under `npm run test:perf`, because the timing measures the
 * machine as much as the code. The counts do not depend on the machine.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import type { FrequentSection, RoutePoint } from '@/types';

type Tick = { serialised: number; bytes: number; ms: number; changed: string[]; layers: boolean };

const mockTicks: Tick[] = [];
const mockPages = new Map<string, (event: { nativeEvent: { data: string } }) => void>();

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
    injectJavaScript: () => {},
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
      let prior: Record<string, unknown> = {};
      return {
        ...patcher,
        next: (specs: { sources: Record<string, unknown> }) => {
          const started = process.hrtime.bigint();
          const result = patcher.next(specs);
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          let bytes = 0;
          for (const [id, spec] of Object.entries(specs.sources)) {
            if (prior[id] !== spec) bytes += JSON.stringify(spec).length;
          }
          prior = specs.sources;
          mockTicks.push({
            serialised: result.serialised,
            bytes,
            ms,
            changed: result.patch?.sources ? Object.keys(result.patch.sources) : [],
            layers: result.patch?.layers !== undefined && result.patch !== null,
          });
          return result;
        },
      };
    },
  };
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
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

function report(label: string, ticks: Tick[]) {
  const sum = (pick: (t: Tick) => number) => ticks.reduce((s, t) => s + pick(t), 0);
  const ms = ticks.map((t) => t.ms).sort((a, b) => a - b);
  process.stderr.write(
    `${label}: ${ticks.length} ticks, serialised/tick ${(sum((t) => t.serialised) / ticks.length).toFixed(1)}, ` +
      `KB/tick ${(sum((t) => t.bytes) / ticks.length / 1024).toFixed(0)}, ` +
      `patch ms median ${ms[Math.floor(ms.length / 2)].toFixed(2)} max ${ms[ms.length - 1].toFixed(2)}, ` +
      `sent [${[...new Set(ticks.flatMap((t) => t.changed))].join(',')}], layers re-sent ${ticks.filter((t) => t.layers).length}\n`
  );
}

beforeEach(() => {
  mockTicks.length = 0;
  mockPages.clear();
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
    report(`section ${count}x${POINTS_PER_TRACE}`, mockTicks);
    expect(mockTicks.length).toBeGreaterThan(0);
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
    report(`route ${count}x${POINTS_PER_TRACE}`, mockTicks);
    expect(mockTicks.length).toBeGreaterThan(0);
  });
});

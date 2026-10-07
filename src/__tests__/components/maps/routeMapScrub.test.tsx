/**
 * Scenario: the athlete scrubs the route chart, which moves the highlighted
 * attempt on every tick, while the route map is up.
 *
 * Expected behaviour: the traces of every attempt cross to the page once. A
 * tick sends the highlight and its endpoints, and the faded layer filters the
 * highlighted attempt out instead of the trace collection being rebuilt.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import type { RoutePoint } from '@/types';

interface Page {
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

const mockPages = new Map<string, Page>();
const mockPatches: { patch: Record<string, unknown> | null; serialised: number }[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    testID?: string;
    onMessage: (event: { nativeEvent: { data: string } }) => void;
  },
  ref: React.Ref<unknown>
) {
  const id = props.testID ?? 'webview';
  mockPages.set(id, { onMessage: props.onMessage });
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

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
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

const trace = (offset: number): RoutePoint[] =>
  Array.from({ length: 8 }, (_, i) => ({
    lat: 46.948 + i * 0.001 + offset,
    lng: 7.447 + i * 0.001,
  }));

const SIGNATURES = {
  a1: { points: trace(0) },
  a2: { points: trace(0.0001) },
  a3: { points: trace(0.0002) },
  a4: { points: trace(0.0003) },
};
const ROUTE = {
  id: 'route-1',
  name: 'Morning loop',
  signature: { points: trace(0), distance: 4200 },
  activityIds: Object.keys(SIGNATURES),
  activityCount: 4,
  type: 'Ride' as const,
};

const TICKS = ['a1', 'a2', 'a3', 'a4', 'a2'];

const map = (highlightedActivityId: string | null) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <RouteMapView
      routeGroup={ROUTE}
      interactive
      activitySignatures={SIGNATURES}
      highlightedActivityId={highlightedActivityId}
    />
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.useFakeTimers();
  mockPages.clear();
  mockPatches.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('scrubbing the route chart', () => {
  const start = () => {
    const view = render(map('a1'));
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the map did not mount');
    act(() => page.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    mockPatches.length = 0;
    return view;
  };

  const scrub = (view: ReturnType<typeof render>) => {
    for (const id of TICKS) {
      view.rerender(map(id));
      act(() => {
        jest.advanceTimersByTime(20);
      });
    }
  };

  it('never re-sends the attempts traces or the route after the map is up', () => {
    const view = start();
    scrub(view);

    const sent = mockPatches.filter((p) => p.patch !== null);
    expect(sent.length).toBeGreaterThan(0);
    for (const { patch } of sent) {
      const sources = Object.keys((patch?.sources ?? {}) as object);
      expect(sources).not.toContain('faded-traces');
      expect(sources).not.toContain('route');
    }
  });

  it('filters the highlighted attempt out of the faded layer', () => {
    const view = start();
    mockPatches.length = 0;
    view.rerender(map('a3'));
    act(() => {
      jest.advanceTimersByTime(20);
    });

    const layers = mockPatches.flatMap(
      (p) => (p.patch?.layers ?? []) as { id: string; filter?: unknown }[]
    );
    const faded = layers.find((l) => l.id === 'faded-traces-line');
    expect(faded?.filter).toEqual(['!=', ['get', 'id'], 'a3']);
  });
});

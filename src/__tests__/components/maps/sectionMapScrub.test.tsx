import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

type Patch = {
  patch: { sources?: Record<string, unknown>; layers?: unknown[] } | null;
  serialised: number;
};

const mockPatches: Patch[] = [];
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

const trace = (offset: number): RoutePoint[] =>
  Array.from({ length: 8 }, (_, i) => ({
    lat: 46.948 + i * 0.001 + offset,
    lng: 7.447 + i * 0.001,
  }));

const traces = {
  a1: trace(0),
  a2: trace(0.0001),
  a3: trace(0.0002),
  a4: trace(0.0003),
};
const section = {
  id: 'section-1',
  sectionType: 'auto',
  name: 'Hill',
  sportTypes: ['Ride'],
  polyline: trace(0),
  distanceMeters: 2000,
  activityIds: Object.keys(traces),
  activityTraces: traces,
  visitCount: 4,
  createdAt: '2026-01-15T10:00:00Z',
} as FrequentSection;
const ids = ['a1', 'a2', 'a3', 'a4', 'a2'];

const map = (highlightedActivityId: string | null) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <SectionMapView
      section={section}
      interactive
      allActivityTraces={traces}
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

it('serialises only the layer list while scrubbing section activity highlights', () => {
  const view = render(map(null));
  const onMessage = mockPages.get('maplibre-map');
  if (!onMessage) throw new Error('the section map did not mount');
  act(() => onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
  mockPatches.length = 0;

  for (const id of ids) {
    view.rerender(map(id));
    act(() => jest.advanceTimersByTime(20));
  }

  expect(mockPatches).toHaveLength(ids.length);
  for (const { patch, serialised } of mockPatches) {
    expect(serialised).toBe(1);
    expect(patch?.sources).toBeUndefined();
    expect(patch?.layers).toBeDefined();
  }
});

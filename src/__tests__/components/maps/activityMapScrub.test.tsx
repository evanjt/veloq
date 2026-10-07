/**
 * Scenario: the athlete scrubs the elevation chart, which moves the highlight
 * index on every frame, while the activity map is up in 2D or 3D.
 *
 * Expected behaviour: the one thing that crosses to the page is the highlight.
 * The track is fitted once when the map is built and never again, the page is
 * never rebuilt, and no other source or the layer list is re-serialised.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import type { LatLng } from '@/shared/geo/polyline';
import type { ActivityDetail } from '@/types';

interface Page {
  html: string[];
  injected: string[];
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
    source: { html: string };
  },
  ref: React.Ref<unknown>
) {
  const id = props.testID ?? 'webview';
  const page = mockPages.get(id) ?? { html: [], injected: [], onMessage: props.onMessage };
  mockPages.set(id, page);
  page.onMessage = props.onMessage;
  if (page.html[page.html.length - 1] !== props.source.html) page.html.push(props.source.html);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => page.injected.push(script),
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

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
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

const COORDINATES: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

// Held stable, as the detail screen holds its overlays across a scrub.
const SECTION_OVERLAYS = [
  {
    id: 's1',
    sectionPolyline: COORDINATES.slice(2, 8),
    activityPortion: COORDINATES.slice(2, 8),
    isPR: true,
  },
  {
    id: 's2',
    sectionPolyline: COORDINATES.slice(6, 11),
    activityPortion: COORDINATES.slice(6, 11),
  },
];

// One highlight move per tick, each held for longer than the throttle.
const TICKS = [1, 2, 3, 4, 5, 6];

const ready = (page: Page) =>
  act(() => page.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));

beforeEach(() => {
  jest.useFakeTimers();
  mockPages.clear();
  mockPatches.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe.each(['sections', 'charts'])('scrubbing the 2D activity map on %s', (tab) => {
  const map = (highlightIndex: number | null) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        coordinates={COORDINATES}
        highlightIndex={highlightIndex}
        activeTab={tab}
        sectionOverlays={SECTION_OVERLAYS}
        routeOverlay={COORDINATES}
      />
    </SafeAreaProvider>
  );

  const scrub = (view: ReturnType<typeof render>) => {
    for (const index of TICKS) {
      view.rerender(map(index));
      act(() => {
        jest.advanceTimersByTime(20);
      });
    }
  };

  const surface = () => {
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the 2D surface did not mount');
    return page;
  };

  it('builds the map fitted to the track, with the shared padding', () => {
    render(map(null));

    expect(surface().html).toHaveLength(1);
    expect(surface().html[0]).toContain(`_fitPadding = ${TRACK_FIT_PADDING}`);
  });

  it('never fits the track a second time, on ready or on scrub', () => {
    const view = render(map(0));
    ready(surface());
    scrub(view);

    expect(surface().injected.filter((s) => s.includes('fitBounds'))).toEqual([]);
    expect(surface().injected.filter((s) => /jumpTo|easeTo/.test(s))).toEqual([]);
  });

  it('keeps the page it was built with', () => {
    const view = render(map(0));
    ready(surface());
    scrub(view);

    expect(surface().html).toHaveLength(1);
  });

  it('re-serialises only the highlight on each tick', () => {
    const view = render(map(0));
    ready(surface());
    mockPatches.length = 0;

    scrub(view);

    const sent = mockPatches.filter((p) => p.patch !== null);
    expect(sent.length).toBeGreaterThan(0);
    for (const { patch, serialised } of mockPatches) {
      expect(serialised).toBe(1);
      if (!patch) continue;
      expect(Object.keys(patch.sources as object)).toEqual(['highlight']);
      expect(patch.layers).toBeUndefined();
    }
  });

  it('serialises once per tick across the whole scrub', () => {
    const view = render(map(0));
    ready(surface());
    mockPatches.length = 0;

    scrub(view);

    expect(mockPatches.filter((p) => p.patch === null)).toEqual([]);
    expect(mockPatches.reduce((sum, p) => sum + p.serialised, 0)).toBe(TICKS.length);
  });

  it('sends the layer list again only when the highlight appears or goes', () => {
    const view = render(map(null));
    ready(surface());
    mockPatches.length = 0;

    view.rerender(map(3));
    act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(mockPatches.some((p) => p.patch?.layers !== undefined)).toBe(true);
  });
});

describe('scrubbing the chart on the charts tab', () => {
  const activity = {
    id: 'a1',
    name: 'Gurten loop',
    type: 'Ride',
    start_date_local: '2026-08-12T07:30:00',
    distance: 32000,
    moving_time: 4200,
    total_elevation_gain: 610,
    polyline: null,
  } as unknown as ActivityDetail;

  const header = (highlightIndex: number | null) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityHeader
        activity={activity}
        activityId={activity.id}
        coordinates={COORDINATES}
        isMetric={true}
        debugEnabled={false}
        mapHeight={360}
        highlightIndex={highlightIndex}
        sectionCreationMode={false}
        sectionCreationState={undefined}
        sectionCreationError={null}
        onSectionCreated={jest.fn()}
        onCreationCancelled={jest.fn()}
        onCreationErrorDismiss={jest.fn()}
        on3DModeChange={jest.fn()}
        onStyleChange={jest.fn()}
        onCameraCapture={jest.fn()}
        initial3DCamera={null}
        activeTab="charts"
        routeOverlayCoordinates={null}
        sectionOverlays={SECTION_OVERLAYS}
        highlightedSectionId={null}
      />
    </SafeAreaProvider>
  );

  it('re-serialises only the highlight, through the header', () => {
    const view = render(header(0));
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the 2D surface did not mount');
    ready(page);
    mockPatches.length = 0;

    for (const index of TICKS) {
      view.rerender(header(index));
      act(() => {
        jest.advanceTimersByTime(20);
      });
    }

    expect(mockPatches.filter((p) => p.patch === null)).toEqual([]);
    expect(mockPatches.reduce((sum, p) => sum + p.serialised, 0)).toBe(TICKS.length);
    for (const { patch, serialised } of mockPatches) {
      expect(serialised).toBe(1);
      if (patch) expect(Object.keys(patch.sources as object)).toEqual(['highlight']);
    }
  });
});

describe('the activity map in 3D', () => {
  const CAMERA = { center: [7.45, 46.95] as [number, number], zoom: 13, bearing: 0, pitch: 60 };

  const map = (highlightIndex: number | null, highlightedSectionId: string | null) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        coordinates={COORDINATES}
        highlightIndex={highlightIndex}
        activeTab="sections"
        sectionOverlays={SECTION_OVERLAYS}
        highlightedSectionId={highlightedSectionId}
        initial3DCamera={CAMERA}
      />
    </SafeAreaProvider>
  );

  it('sends the highlight only when the highlight moves', () => {
    const view = render(map(3, null));
    const page = mockPages.get('webview');
    if (!page) throw new Error('the 3D page did not mount');
    ready(page);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    page.injected.length = 0;

    for (const selected of ['s1', null, 's1']) {
      view.rerender(map(3, selected));
      act(() => {
        jest.advanceTimersByTime(100);
      });
    }

    expect(page.injected.filter((s) => s.includes('highlight-point'))).toEqual([]);
  });
});

describe('scrubbing the 3D activity map', () => {
  const COORDS: [number, number][] = COORDINATES.map((c) => [c.longitude, c.latitude]);

  const terrain = (highlightCoordinate: [number, number] | null) => (
    <Map3DWebView coordinates={COORDS} mapStyle="light" highlightCoordinate={highlightCoordinate} />
  );

  it('keeps the page and moves the highlight by injected script', () => {
    const view = render(terrain(null));
    const page = mockPages.get('webview');
    if (!page) throw new Error('the 3D page did not mount');
    ready(page);
    page.injected.length = 0;

    for (const coordinate of COORDS.slice(0, 6)) {
      view.rerender(terrain(coordinate));
      act(() => {
        jest.advanceTimersByTime(40);
      });
    }

    expect(page.html).toHaveLength(1);
    const moves = page.injected.filter((s) => s.includes("getSource('highlight-point').setData"));
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[moves.length - 1]).toContain(`${COORDS[5][0]}, ${COORDS[5][1]}`);
    expect(page.injected.filter((s) => /fitBounds|jumpTo|easeTo/.test(s))).toEqual([]);
  });
});

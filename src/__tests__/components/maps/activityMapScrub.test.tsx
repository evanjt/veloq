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
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import type { LatLng } from '@/shared/geo/polyline';
import { renderStaged } from '../../__shared__/stagedRender';

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

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
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

  const scrub = async (view: Awaited<ReturnType<typeof renderStaged>>) => {
    for (const index of TICKS) {
      await view.rerender(map(index));
      await act(() => {
        jest.advanceTimersByTime(20);
      });
    }
  };

  const surface = () => {
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the 2D surface did not mount');
    return page;
  };

  it('builds the map fitted to the track below the header', async () => {
    await renderStaged(map(null));

    expect(surface().html).toHaveLength(1);
    const literal = /_fitPadding = (\{[^}]*\})/.exec(surface().html[0])?.[1];
    expect(literal).toBeDefined();
    const padding = JSON.parse(literal!) as Record<'top' | 'right' | 'bottom' | 'left', number>;
    expect(padding.left).toBe(TRACK_FIT_PADDING);
    expect(padding.top).toBeGreaterThan(TRACK_FIT_PADDING);
    expect(padding.right).toBe(TRACK_FIT_PADDING);
  });

  it('builds the map fitted beside a side panel that covers its leading edge', async () => {
    await renderStaged(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActivityMapView
          activityType="Ride"
          coordinates={COORDINATES}
          highlightIndex={null}
          activeTab={tab}
          coveredLeft={320}
        />
      </SafeAreaProvider>
    );

    const literal = /_fitPadding = (\{[^}]*\})/.exec(surface().html[0])?.[1];
    const padding = JSON.parse(literal!) as Record<'top' | 'right' | 'bottom' | 'left', number>;
    expect(padding.left).toBeGreaterThanOrEqual(320);
  });

  it('never fits the track a second time, on ready or on scrub', async () => {
    const view = await renderStaged(map(0));
    await ready(surface());
    await scrub(view);

    expect(surface().injected.filter((s) => s.includes('fitBounds'))).toEqual([]);
    expect(surface().injected.filter((s) => /jumpTo|easeTo/.test(s))).toEqual([]);
  });

  it('keeps the page it was built with', async () => {
    const view = await renderStaged(map(0));
    await ready(surface());
    await scrub(view);

    expect(surface().html).toHaveLength(1);
  });

  it('re-serialises only the highlight on each tick', async () => {
    const view = await renderStaged(map(0));
    await ready(surface());
    mockPatches.length = 0;

    await scrub(view);

    const sent = mockPatches.filter((p) => p.patch !== null);
    expect(sent.length).toBeGreaterThan(0);
    for (const { patch, serialised } of mockPatches) {
      expect(serialised).toBe(1);
      if (!patch) continue;
      expect(Object.keys(patch.sources as object)).toEqual(['highlight']);
      expect(patch.layers).toBeUndefined();
    }
  });

  it('serialises once per tick across the whole scrub', async () => {
    const view = await renderStaged(map(0));
    await ready(surface());
    mockPatches.length = 0;

    await scrub(view);

    expect(mockPatches.filter((p) => p.patch === null)).toEqual([]);
    expect(mockPatches.reduce((sum, p) => sum + p.serialised, 0)).toBe(TICKS.length);
  });

  it('sends the layer list again only when the highlight appears or goes', async () => {
    const view = await renderStaged(map(null));
    await ready(surface());
    mockPatches.length = 0;

    await view.rerender(map(3));
    await act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(mockPatches.some((p) => p.patch?.layers !== undefined)).toBe(true);
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

  it('sends the highlight only when the highlight moves', async () => {
    const view = await renderStaged(map(3, null));
    const page = mockPages.get('webview');
    if (!page) throw new Error('the 3D page did not mount');
    await ready(page);
    await act(() => {
      jest.advanceTimersByTime(100);
    });
    page.injected.length = 0;

    for (const selected of ['s1', null, 's1']) {
      await view.rerender(map(3, selected));
      await act(() => {
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

  it('keeps the page and moves the highlight by injected script', async () => {
    const view = await renderStaged(terrain(null));
    const page = mockPages.get('webview');
    if (!page) throw new Error('the 3D page did not mount');
    await ready(page);
    page.injected.length = 0;

    for (const coordinate of COORDS.slice(0, 6)) {
      await view.rerender(terrain(coordinate));
      await act(() => {
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

describe('the activity line on the 2D map', () => {
  const map = (hasStoredTrack: boolean, highlightIndex: number | null = null) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        activityId="i9001"
        hasStoredTrack={hasStoredTrack}
        coordinates={COORDINATES}
        highlightIndex={highlightIndex}
      />
    </SafeAreaProvider>
  );

  const routeData = () => {
    const sent = mockPatches.find((p) => p.patch?.sources);
    const sources = sent?.patch?.sources as Record<string, { data: unknown }> | undefined;
    return sources?.route?.data;
  };

  const surface = () => {
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the 2D surface did not mount');
    return page;
  };

  it('names the engine URL when the engine holds the track', async () => {
    await renderStaged(map(true));
    await ready(surface());

    expect(routeData()).toEqual(expect.stringMatching(/veloq-geo\/track\/i9001\?v=0$/));
  });

  it('sends the line inline when the engine holds no track', async () => {
    await renderStaged(map(false));
    await ready(surface());

    const data = routeData() as GeoJSON.Feature<GeoJSON.LineString>;
    expect(data.geometry.coordinates).toHaveLength(COORDINATES.length);
  });

  it('keeps the URL through a scrub, sending the highlight alone', async () => {
    const view = await renderStaged(map(true, 0));
    await ready(surface());
    mockPatches.length = 0;

    for (const index of TICKS) {
      await view.rerender(map(true, index));
      await act(() => {
        jest.advanceTimersByTime(20);
      });
    }

    for (const { patch } of mockPatches) {
      if (patch?.sources) expect(Object.keys(patch.sources as object)).toEqual(['highlight']);
    }
  });
});

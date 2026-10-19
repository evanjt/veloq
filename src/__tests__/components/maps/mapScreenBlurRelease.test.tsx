/**
 * Scenario: an activity or section map is on a stack screen, and the athlete
 * opens another screen over it.
 * Expected behaviour: each of the covered screen's pages receives the release
 * script, nothing more reaches a released page, and when the screen is shown
 * again each page is rebuilt once, at the camera it had settled on. Inside a detail host the map's
 * own screen is covered by the host's sheet, which is not the map being covered: the map follows
 * the host's focus there and is released only under a screen pushed over the host.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { rebuildReleasedSurfaces } from '@/features/maps/lib/mapSurfaceRegistry';
import { MapSheetHostContext, type MapSheetHostValue } from '@/shared/app/MapSheetHost';
import type { LatLng } from '@/shared/geo/polyline';
import type { FrequentSection, RoutePoint } from '@/types';

interface Page {
  html: string[];
  injected: string[];
  reloads: number;
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

const mockPages = new Map<string, Page>();
const mockFocus = { focused: true, listeners: new Set<() => void>() };

jest.mock('expo-router', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  return {
    ...jest.requireActual('expo-router'),
    useIsFocused: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockFocus.listeners.add(listener);
          return () => mockFocus.listeners.delete(listener);
        },
        () => mockFocus.focused
      ),
  };
});

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
  const page = mockPages.get(id) ?? {
    html: [],
    injected: [],
    reloads: 0,
    onMessage: props.onMessage,
  };
  mockPages.set(id, page);
  page.onMessage = props.onMessage;
  if (page.html[page.html.length - 1] !== props.source.html) page.html.push(props.source.html);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => page.injected.push(script),
    reload: () => {
      page.reloads++;
    },
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

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

const PAGE_2D = 'maplibre-map';
const PAGE_3D = 'webview';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const POLYLINE: RoutePoint[] = COORDINATES.map((c) => ({ lat: c.latitude, lng: c.longitude }));

const OPENING_3D = { center: [7.45, 46.95] as [number, number], zoom: 13, bearing: 0, pitch: 60 };
const SETTLED_3D = {
  center: [7.4523, 46.9561] as [number, number],
  zoom: 14.25,
  bearing: 31,
  pitch: 55,
};
const SETTLED_2D = {
  center: [7.4487, 46.9512] as [number, number],
  zoom: 15.5,
  bearing: 0,
  pitch: 0,
  bounds: { sw: [7.44, 46.94] as [number, number], ne: [7.46, 46.96] as [number, number] },
};

function page(id: string): Page {
  const found = mockPages.get(id);
  if (!found) throw new Error(`page ${id} did not mount`);
  return found;
}

async function post(id: string, message: Record<string, unknown>): Promise<void> {
  await act(() => page(id).onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
}

async function setFocused(focused: boolean): Promise<void> {
  await act(() => {
    mockFocus.focused = focused;
    mockFocus.listeners.forEach((listener) => listener());
  });
}

/** Reloads plus pages loaded after the first. */
function rebuilds(id: string): number {
  return page(id).reloads + page(id).html.length - 1;
}

function lastScript(id: string): string | undefined {
  return page(id).injected[page(id).injected.length - 1];
}

function activityMap(props: Partial<React.ComponentProps<typeof ActivityMapView>> = {}) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle {...props} />
    </SafeAreaProvider>
  );
}

function hosted(map: React.ReactElement, focused: boolean) {
  const host: MapSheetHostValue = {
    kind: 'activity',
    id: 'orchard-ride',
    key: 'activity:orchard-ride',
    focused,
    setHeaderOptions: () => {},
  };
  return <MapSheetHostContext.Provider value={host}>{map}</MapSheetHostContext.Provider>;
}

function section(): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'Harbour climb',
    sportTypes: ['Ride'],
    polyline: POLYLINE,
    distanceMeters: 1200,
    activityIds: ['a1', 'a2'],
    visitCount: 7,
    createdAt: '2026-01-15T10:00:00Z',
  };
}

function sectionMap(props: Partial<React.ComponentProps<typeof SectionMapView>> = {}) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={section()} interactive {...props} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockPages.clear();
  mockFocus.focused = true;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('an activity map on a covered screen', () => {
  it('releases the 3D page on blur and rebuilds it once, at its camera, on focus', async () => {
    jest.useFakeTimers();
    const view = await render(activityMap({ initial3DCamera: OPENING_3D }));
    await post(PAGE_3D, { type: 'mapReady' });
    await post(PAGE_3D, { type: 'cameraState', camera: SETTLED_3D, gesture: true });

    await setFocused(false);
    expect(lastScript(PAGE_3D)).toContain('map.remove()');

    page(PAGE_3D).injected.length = 0;
    await view.rerender(
      activityMap({
        initial3DCamera: OPENING_3D,
        highlightIndex: 3,
        sectionOverlays: [{ id: 's1', sectionPolyline: COORDINATES.slice(2, 8) }],
      })
    );
    expect(page(PAGE_3D).injected).toEqual([]);
    expect(rebuilds(PAGE_3D)).toBe(0);

    await setFocused(true);
    expect(rebuilds(PAGE_3D)).toBe(1);
    const rebuilt = page(PAGE_3D).html[page(PAGE_3D).html.length - 1];
    expect(rebuilt).toContain(String(SETTLED_3D.center[0]));
    expect(rebuilt).toContain(String(SETTLED_3D.zoom));
    expect(page(PAGE_3D).injected).toEqual([]);

    await post(PAGE_3D, { type: 'mapReady' });
    await act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(page(PAGE_3D).injected.length).toBeGreaterThan(0);
    await view.unmount();
  });

  it('reloads the 3D page when its camera never moved', async () => {
    const view = await render(activityMap({ initial3DCamera: OPENING_3D }));
    await post(PAGE_3D, { type: 'mapReady' });

    await setFocused(false);
    await setFocused(true);

    expect(page(PAGE_3D).reloads).toBe(1);
    expect(rebuilds(PAGE_3D)).toBe(1);
    await view.unmount();
  });

  it('releases the 2D page on blur and rebuilds it once, at its settled camera, on focus', async () => {
    const view = await render(activityMap());
    await post(PAGE_2D, { type: 'mapReady' });
    await post(PAGE_2D, { type: 'regionDidChange', ...SETTLED_2D, isUserInteraction: true });

    await setFocused(false);
    expect(lastScript(PAGE_2D)).toContain('map.remove()');

    page(PAGE_2D).injected.length = 0;
    await view.rerender(
      activityMap({ sectionOverlays: [{ id: 's1', sectionPolyline: COORDINATES.slice(2, 8) }] })
    );
    expect(page(PAGE_2D).injected).toEqual([]);

    await setFocused(true);
    expect(rebuilds(PAGE_2D)).toBe(1);
    const rebuilt = page(PAGE_2D).html[page(PAGE_2D).html.length - 1];
    expect(rebuilt).toContain(String(SETTLED_2D.center[0]));
    expect(rebuilt).toContain(String(SETTLED_2D.zoom));
    await view.unmount();
  });

  it('stays released through a foreground until its screen is shown again', async () => {
    const view = await render(activityMap({ initial3DCamera: OPENING_3D }));
    await post(PAGE_3D, { type: 'mapReady' });

    await setFocused(false);
    await act(() => {
      rebuildReleasedSurfaces();
    });
    expect(rebuilds(PAGE_3D)).toBe(0);

    await setFocused(true);
    expect(rebuilds(PAGE_3D)).toBe(1);
    await act(() => {
      rebuildReleasedSurfaces();
    });
    expect(rebuilds(PAGE_3D)).toBe(1);
    await view.unmount();
  });

  it('releases a page that finished loading after its screen was covered', async () => {
    jest.useFakeTimers();
    const view = await render(activityMap({ initial3DCamera: OPENING_3D }));

    await setFocused(false);
    page(PAGE_3D).injected.length = 0;
    await post(PAGE_3D, { type: 'mapReady' });
    await act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(page(PAGE_3D).injected).toHaveLength(1);
    expect(lastScript(PAGE_3D)).toContain('map.remove()');

    await setFocused(true);
    expect(rebuilds(PAGE_3D)).toBe(1);
    await view.unmount();
  });

  it('does nothing to a page on a screen that stays shown', async () => {
    const view = await render(activityMap({ initial3DCamera: OPENING_3D }));
    await post(PAGE_3D, { type: 'mapReady' });

    await setFocused(true);

    expect(page(PAGE_3D).injected.some((script) => script.includes('map.remove()'))).toBe(false);
    expect(rebuilds(PAGE_3D)).toBe(0);
    await view.unmount();
  });
});

describe('a section map on a covered screen', () => {
  it('releases the 2D page on blur and rebuilds it once, at its settled camera, on focus', async () => {
    const view = await render(sectionMap());
    await post(PAGE_2D, { type: 'mapReady' });
    await post(PAGE_2D, { type: 'regionDidChange', ...SETTLED_2D, isUserInteraction: true });

    await setFocused(false);
    expect(lastScript(PAGE_2D)).toContain('map.remove()');

    page(PAGE_2D).injected.length = 0;
    await view.rerender(sectionMap({ trimRange: { start: 1, end: 3 } }));
    expect(page(PAGE_2D).injected).toEqual([]);

    await setFocused(true);
    expect(rebuilds(PAGE_2D)).toBe(1);
    expect(page(PAGE_2D).html[page(PAGE_2D).html.length - 1]).toContain(
      String(SETTLED_2D.center[0])
    );
    await view.unmount();
  });

  it('releases the 3D page on blur and rebuilds it once, at its camera, on focus', async () => {
    const view = await render(sectionMap());
    await fireEvent.press(view.getByTestId('section-map-3d-toggle'));
    await post(PAGE_3D, { type: 'mapReady' });
    await post(PAGE_3D, { type: 'cameraState', camera: SETTLED_3D, gesture: true });

    await setFocused(false);
    expect(lastScript(PAGE_3D)).toContain('map.remove()');

    page(PAGE_3D).injected.length = 0;
    await view.rerender(sectionMap({ trimRange: { start: 1, end: 3 } }));
    expect(page(PAGE_3D).injected).toEqual([]);

    await setFocused(true);
    expect(rebuilds(PAGE_3D)).toBe(1);
    expect(page(PAGE_3D).html[page(PAGE_3D).html.length - 1]).toContain(
      String(SETTLED_3D.center[0])
    );
    await view.unmount();
  });
});

describe.each([
  ['an activity map', () => activityMap()],
  ['a section map', () => sectionMap()],
])('%s in a detail host', (_name, map) => {
  function released(): boolean {
    return page(PAGE_2D).injected.some((script) => script.includes('map.remove()'));
  }

  it('stays held while only its own sheet covers its screen', async () => {
    const view = await render(hosted(map(), true));
    await post(PAGE_2D, { type: 'mapReady' });

    await setFocused(false);

    expect(released()).toBe(false);
    expect(rebuilds(PAGE_2D)).toBe(0);
    await view.unmount();
  });

  it('is released under a screen pushed over the host and rebuilt once when it is shown again', async () => {
    const view = await render(hosted(map(), true));
    await post(PAGE_2D, { type: 'mapReady' });
    await setFocused(false);

    await view.rerender(hosted(map(), false));
    expect(released()).toBe(true);

    await view.rerender(hosted(map(), true));
    expect(rebuilds(PAGE_2D)).toBe(1);
    await view.unmount();
  });
});

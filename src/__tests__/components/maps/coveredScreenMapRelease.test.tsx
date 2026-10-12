/**
 * Scenario: the route detail hero, the recording map, the two preview maps and
 * the home radius map each sit on a stack screen, and the athlete opens another
 * screen over it. The route hero also sits under its own fullscreen map.
 * Expected behaviour: the covered page receives the release script and is
 * rebuilt once when its screen is shown again; the route hero is released while
 * its fullscreen map is open and rebuilt once when it closes.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RouteMapView } from '@/features/routes/components/RouteMapView';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import { GroupingPreviewMap } from '@/features/routes/components/preview/GroupingPreviewMap';
import { HomeRadiusMap } from '@/features/maps/components/HomeRadiusMap';
import type { RoutePoint } from '@/types';

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

// The fullscreen map is a page of its own; only the hero under it is watched.
jest.mock('@/features/maps/components/BaseMapView', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return { BaseMapView: () => <MockView testID="fullscreen-map" /> };
});

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 7.447, latitude: 46.948 },
      { longitude: 7.448, latitude: 46.949 },
    ],
  })
);
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

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

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const POINTS: RoutePoint[] = Array.from({ length: 12 }, (_, i) => ({
  lat: 46.948 + i * 0.001,
  lng: 7.447 + i * 0.001,
}));

const TRACK: [number, number][] = POINTS.map((p) => [p.lat, p.lng]);

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

function released(id: string): boolean {
  return page(id).injected.some((script) => script.includes('map.remove()'));
}

function routeMap(props: Partial<React.ComponentProps<typeof RouteMapView>> = {}) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <RouteMapView
        routeGroup={{
          id: 'route-1',
          name: 'Harbour loop',
          signature: { points: POINTS, distance: 4200 },
          activityIds: ['a1', 'a2'],
          activityCount: 2,
          type: 'Ride',
        }}
        {...props}
      />
    </SafeAreaProvider>
  );
}

const SCREENS: { name: string; pageId: string; element: () => React.ReactElement }[] = [
  { name: 'route detail hero', pageId: 'maplibre-map', element: () => routeMap() },
  {
    name: 'recording map',
    pageId: 'maplibre-map',
    element: () => (
      <RecordingMap coordinates={TRACK} currentLocation={{ latitude: 46.95, longitude: 7.45 }} />
    ),
  },
  {
    name: 'section preview map',
    pageId: 'preview-map',
    element: () => (
      <PreviewMapView
        result={null}
        currentSections={[]}
        centre={null}
        selectedId={null}
        showCurrent
        showProposed
        showRemoved
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onToggleRemoved={jest.fn()}
        onSelect={jest.fn()}
      />
    ),
  },
  {
    name: 'grouping preview map',
    pageId: 'grouping-preview-map',
    element: () => (
      <GroupingPreviewMap
        routes={[{ groupId: 'g1', encodedPolyline: new ArrayBuffer(0) }]}
        centre={null}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    ),
  },
  {
    name: 'home radius map',
    pageId: 'maplibre-map',
    element: () => <HomeRadiusMap home={[7.45, 46.95]} radiusM={200} onMove={jest.fn()} />,
  },
];

beforeEach(() => {
  mockPages.clear();
  mockFocus.focused = true;
});

describe.each(SCREENS)('the $name on a covered screen', ({ pageId, element }) => {
  it('releases the page on blur and rebuilds it once on focus', async () => {
    const view = await render(element());
    await post(pageId, { type: 'mapReady' });
    expect(released(pageId)).toBe(false);

    await setFocused(false);
    expect(released(pageId)).toBe(true);
    expect(rebuilds(pageId)).toBe(0);

    await setFocused(true);
    expect(rebuilds(pageId)).toBe(1);
    await view.unmount();
  });

  it('does nothing to the page while its screen stays shown', async () => {
    const view = await render(element());
    await post(pageId, { type: 'mapReady' });

    await setFocused(true);

    expect(released(pageId)).toBe(false);
    expect(rebuilds(pageId)).toBe(0);
    await view.unmount();
  });
});

describe('the route detail hero under its own fullscreen map', () => {
  it('is released while fullscreen is open and rebuilt once when it closes', async () => {
    const view = await render(routeMap({ enableFullscreen: true }));
    await post('maplibre-map', { type: 'mapReady' });

    await fireEvent.press(view.getByTestId('route-map-container'));
    expect(view.getByTestId('fullscreen-map')).toBeTruthy();
    expect(released('maplibre-map')).toBe(true);
    expect(rebuilds('maplibre-map')).toBe(0);

    await act(() => {
      view.UNSAFE_getByProps({ visible: true }).props.onRequestClose();
    });
    expect(view.queryByTestId('fullscreen-map')).toBeNull();
    expect(rebuilds('maplibre-map')).toBe(1);
    await view.unmount();
  });
});

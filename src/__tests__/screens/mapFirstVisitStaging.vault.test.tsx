/**
 * Scenario: the athlete opens the Map tab for the first time.
 * Expected behaviour: the first commit carries the screen and its filter sheet
 * with no map page in it, and the map page mounts once on the following frame.
 * The screen stays mounted after that, so a return to the tab is not staged
 * again: the page is back in the commit that shows the tab, built once. The
 * ready marker a capture flow waits on appears with the map page, never with
 * the screen alone.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from '@/app/(tabs)/map';
import { passFrames } from '../__shared__/stagedRender';

const mockPageHtml: string[] = [];
let mockPageMounts = 0;
const mockFocus = { focused: true, listeners: new Set<() => void>() };

jest.mock('expo-router', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (listener: () => void) => {
    mockFocus.listeners.add(listener);
    return () => mockFocus.listeners.delete(listener);
  };
  return {
    ...jest.requireActual('expo-router'),
    useRouter: () => ({ push: jest.fn() }),
    useSegments: () => ['(tabs)', 'map'],
    useLocalSearchParams: () => ({}),
    useIsFocused: () => useSyncExternalStore(subscribe, () => mockFocus.focused),
    usePathname: () =>
      useSyncExternalStore(subscribe, () => (mockFocus.focused ? '/map' : '/fitness')),
  };
});

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { source: { html: string } },
  ref: React.Ref<unknown>
) {
  React.useEffect(() => {
    mockPageMounts++;
  }, []);
  if (mockPageHtml[mockPageHtml.length - 1] !== props.source.html) {
    mockPageHtml.push(props.source.html);
  }
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View testID="map-page" />;
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
    getGlobalMapStyle: () => 'light',
    setGlobalMapStyle: () => {},
  }),
}));

jest.mock('@/features/maps/hooks/useEngineMapActivities', () => ({
  useEngineMapActivities: () => ({
    activities: [],
    availableTypes: [],
    categoryCounts: [],
    totalCount: 0,
    unmapped: { withoutGps: 0, downloading: 0 },
    routeCount: 0,
    routeLines: null,
    sectionCount: 0,
    sections: [],
    sectionsGeoJSON: null,
    emptyReason: null,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));

jest.mock('@/features/activity', () => ({
  useActivityBoundsCache: () => ({
    isReady: true,
    cacheStats: { oldestDate: null, newestDate: null },
  }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false, colors: {} }),
  useMetricSystem: () => true,
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function screen() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <MapScreen />
    </SafeAreaProvider>
  );
}

async function setFocused(focused: boolean): Promise<void> {
  await act(() => {
    mockFocus.focused = focused;
    mockFocus.listeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  mockPageHtml.length = 0;
  mockPageMounts = 0;
  mockFocus.focused = true;
});

describe('the map tab on its first visit', () => {
  it('commits the screen and its sheet first and mounts the map page on the next frame', async () => {
    const view = await render(screen());

    expect(view.getByTestId('map-screen')).toBeTruthy();
    expect(view.getByTestId('map-filter-sheet')).toBeTruthy();
    expect(view.queryByTestId('map-page', { includeHiddenElements: true })).toBeNull();
    expect(mockPageMounts).toBe(0);

    await passFrames();
    expect(view.getByTestId('map-page', { includeHiddenElements: true })).toBeTruthy();
    expect(mockPageMounts).toBe(1);
    expect(mockPageHtml).toHaveLength(1);
    expect(mockPageHtml[0]).toContain('<html');
    await view.unmount();
  });

  it('does not stage the page again when the kept-mounted screen is shown a second time', async () => {
    const view = await render(screen());
    await passFrames();
    expect(mockPageMounts).toBe(1);

    await setFocused(false);
    expect(view.queryByTestId('map-page', { includeHiddenElements: true })).toBeNull();

    await setFocused(true);
    expect(view.getByTestId('map-page', { includeHiddenElements: true })).toBeTruthy();
    expect(mockPageMounts).toBe(2);

    await passFrames();
    expect(mockPageMounts).toBe(2);
    await view.unmount();
  });

  it('shows the map ready marker only once the map page has mounted', async () => {
    const view = await render(screen());
    expect(view.getByTestId('map-screen')).toBeTruthy();
    expect(view.queryByTestId('regional-map-ready', { includeHiddenElements: true })).toBeNull();

    await passFrames();
    expect(view.getByTestId('regional-map-ready', { includeHiddenElements: true })).toBeTruthy();
    await view.unmount();
  });

  it('keeps the map ready marker in the native hierarchy with a size a flow can see', async () => {
    const view = await render(screen());
    await passFrames();
    const marker = view.getByTestId('regional-map-ready', { includeHiddenElements: true });
    // Android flattens an empty view away, and a flow never finds a view with no area.
    expect(marker.props.collapsable).toBe(false);
    expect(StyleSheet.flatten(marker.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    await view.unmount();
  });
});

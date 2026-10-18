/**
 * Scenario: a map detail screen owns its map and its sheet through a nested stack, under a real
 * router. The sheet screen covers the map screen inside that stack, which is not the map being
 * covered, while a screen of the root stack pushed over the host is.
 *
 * Expected behaviour: opening the host mounts the map screen, which presents the sheet with the
 * params it was opened with, both in one nested stack; the map stays held while only its own sheet is on top
 * and is released under another screen; popping the host takes both screens; Android's back on
 * the sheet leaves the host in one press; iOS keeps a strip over the map's leading edge for the
 * stack's edge swipe. On a tablet-width window there is no sheet: the map screen draws the card in
 * a side panel, the nested stack holds the map alone, and back still leaves in one step; a window
 * resized across that width presents the sheet or takes it down.
 */

import React, { useEffect } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import {
  createMapSheetHostLayout,
  MapSheetHostMap,
  MapSheetHostSheet,
  useMapHeldFocus,
  useMapSheetHost,
} from '@/shared/app/MapSheetHost';
import { useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { MAP_SHEET_PEEK_STOP, useMapSheetStop, useMapSheetStops } from '@/shared/app/mapSheetStop';
import { stubHardwareBack, type HardwareBack } from '../__shared__/hardwareBack';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 1366 };
const mockWindow = {
  size: PHONE,
  listeners: new Set<() => void>(),
  resize(size: { width: number; height: number }) {
    this.size = size;
    this.listeners.forEach((listener) => listener());
  },
};
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => {
    const size = require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockWindow.listeners.add(listener);
        return () => mockWindow.listeners.delete(listener);
      },
      () => mockWindow.size
    );
    return { ...size, scale: 3, fontScale: 1 };
  },
}));

const mounted = new Set<string>();

function useMountedAs(name: string) {
  useEffect(() => {
    mounted.add(name);
    return () => {
      mounted.delete(name);
    };
  }, [name]);
}

function OrchardMap() {
  useMountedAs('map');
  const held = useMapHeldFocus();
  const { leaveTool } = useMapSheetStop(useMapSheetHost()?.key ?? '');
  return (
    <MapSheetHostMap panel={<OrchardCard />}>
      <Text testID="orchard-map">{held ? 'held' : 'released'}</Text>
      <Pressable testID="orchard-tool-save" onPress={leaveTool} />
    </MapSheetHostMap>
  );
}

function OrchardCard() {
  const host = useMapSheetHost();
  const { picker } = useLocalSearchParams<{ picker?: string }>();
  const { enterTool, onDetentChanged } = useMapSheetStop(host?.key ?? '');
  return (
    <>
      <Text testID="orchard-card">{`${host?.id}:${picker ?? ''}`}</Text>
      <Pressable testID="orchard-tool" onPress={enterTool} />
      <Pressable
        testID="orchard-drag-to-peek"
        onPress={() => onDetentChanged({ index: MAP_SHEET_PEEK_STOP, isStable: true })}
      />
    </>
  );
}

function OrchardSheet() {
  useMountedAs('sheet');
  return (
    <MapSheetHostSheet>
      <OrchardCard />
    </MapSheetHostSheet>
  );
}

let app: Awaited<ReturnType<typeof renderRouter>>;
const originalOS = Platform.OS;

async function openOrchard() {
  app = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>feed</Text>,
      'orchard/[id]/_layout': createMapSheetHostLayout('route'),
      'orchard/[id]/index': OrchardMap,
      'orchard/[id]/sheet': OrchardSheet,
      barn: () => <Text>barn</Text>,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push('/orchard/pear?picker=quince'));
}

type RouteNode = { name: string; params?: object; state?: { routes: RouteNode[] } };

/** The screens in the host's nested stack, in order. */
function nestedStack(): RouteNode[] {
  const find = (routes: RouteNode[]): RouteNode | undefined =>
    routes.reduce<RouteNode | undefined>(
      (found, route) =>
        found ?? (route.name === 'orchard/[id]' ? route : find(route.state?.routes ?? [])),
      undefined
    );
  const host = find((app.getRouterState()?.routes ?? []) as RouteNode[]);
  return host?.state?.routes ?? [];
}

/** The names of the screens in the host's nested stack, in order. */
function nestedRoutes(): string[] {
  return nestedStack().map((route) => route.name);
}

/** The stop the sheet screen was presented at, as its params carry it. */
function presentedStop(): unknown {
  return (nestedStack().at(-1)?.params as { stop?: unknown } | undefined)?.stop;
}

beforeEach(() => {
  mockWindow.size = PHONE;
  mounted.clear();
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
});

afterEach(() => {
  Platform.OS = originalOS;
});

describe('a map sheet host', () => {
  it('mounts the map and presents the sheet with the screen’s params in one nested stack', async () => {
    await openOrchard();

    expect(nestedRoutes()).toEqual(['index', 'sheet']);
    expect([...mounted].sort()).toEqual(['map', 'sheet']);
    expect(app.getByTestId('orchard-card')).toHaveTextContent('pear:quince');
    expect(useMapSheetHosts.getState().hosts['route:pear']?.cards).toHaveLength(1);
  });

  it('holds the map while only its own sheet is on top, and releases it under another screen', async () => {
    await openOrchard();
    expect(app.getByTestId('orchard-map', { includeHiddenElements: true })).toHaveTextContent(
      'held'
    );

    await act(() => router.push('/barn'));

    expect(app.getByTestId('orchard-map', { includeHiddenElements: true })).toHaveTextContent(
      'released'
    );

    await act(() => router.back());

    expect(app.getByTestId('orchard-map', { includeHiddenElements: true })).toHaveTextContent(
      'held'
    );
  });

  it('takes the map and the sheet with it when the host is popped, and drops its entry', async () => {
    await openOrchard();

    await act(() => router.dismissTo('/'));

    expect(app.getPathname()).toBe('/');
    expect(mounted.size).toBe(0);
    expect(useMapSheetHosts.getState().hosts).toEqual({});
  });

  it('puts the sheet away while a tool runs and presents it again at Half when it ends', async () => {
    await openOrchard();

    await act(async () => fireEvent.press(app.getByTestId('orchard-tool')));

    expect(nestedRoutes()).toEqual(['index']);
    expect([...mounted]).toEqual(['map']);

    await act(async () =>
      fireEvent.press(app.getByTestId('orchard-tool-save', { includeHiddenElements: true }))
    );

    expect(nestedRoutes()).toEqual(['index', 'sheet']);
    expect(presentedStop()).toBe(1);
    expect(app.getByTestId('orchard-card')).toHaveTextContent('pear:quince');
  });

  it('presents the sheet at Peek after a tool when the athlete had dragged it there', async () => {
    await openOrchard();
    await act(async () => fireEvent.press(app.getByTestId('orchard-drag-to-peek')));

    await act(async () => fireEvent.press(app.getByTestId('orchard-tool')));
    await act(async () =>
      fireEvent.press(app.getByTestId('orchard-tool-save', { includeHiddenElements: true }))
    );

    expect(nestedRoutes()).toEqual(['index', 'sheet']);
    expect(presentedStop()).toBe(MAP_SHEET_PEEK_STOP);
  });

  it('draws a strip over the map’s leading edge for the iOS edge swipe', async () => {
    await openOrchard();

    expect(app.getByTestId('map-sheet-back-edge', { includeHiddenElements: true })).toBeTruthy();
  });

  describe('on a tablet-width window', () => {
    beforeEach(() => {
      mockWindow.size = TABLET;
    });

    it('draws the card in a side panel beside the map and presents no sheet', async () => {
      await openOrchard();

      expect(nestedRoutes()).toEqual(['index']);
      expect([...mounted]).toEqual(['map']);
      expect(app.getByTestId('map-sheet-panel')).toHaveStyle({ width: 400 });
      expect(app.getByTestId('orchard-card')).toHaveTextContent('pear:quince');
      expect(app.getByTestId('orchard-map')).toHaveTextContent('held');
      expect(app.queryByTestId('map-sheet-back-edge', { includeHiddenElements: true })).toBeNull();
    });

    it('takes the sheet down as the window widens, and presents it again as it narrows', async () => {
      mockWindow.size = PHONE;
      await openOrchard();
      expect(nestedRoutes()).toEqual(['index', 'sheet']);

      await act(async () => mockWindow.resize(TABLET));
      expect(nestedRoutes()).toEqual(['index']);
      expect(app.getByTestId('map-sheet-panel')).toBeTruthy();

      await act(async () => mockWindow.resize(PHONE));
      expect(nestedRoutes()).toEqual(['index', 'sheet']);
      expect(app.queryByTestId('map-sheet-panel')).toBeNull();
    });

    it('leaves the host in one press of Android back', async () => {
      Platform.OS = 'android';
      const back = stubHardwareBack();
      try {
        await openOrchard();

        await act(async () => {
          expect(back.press()).toBe(true);
        });

        expect(app.getPathname()).toBe('/');
        expect(mounted.size).toBe(0);
      } finally {
        back.restore();
      }
    });
  });

  describe('on Android', () => {
    let back: HardwareBack;

    beforeEach(() => {
      Platform.OS = 'android';
      back = stubHardwareBack();
    });

    afterEach(() => back.restore());

    it('leaves the host with its sheet in one press of back', async () => {
      await openOrchard();

      await act(async () => {
        expect(back.press()).toBe(true);
      });

      expect(app.getPathname()).toBe('/');
      expect(mounted.size).toBe(0);
    });

    it('pops only the screen covering the host, leaving the host and its sheet', async () => {
      await openOrchard();
      await act(() => router.push('/barn'));

      await act(async () => {
        back.press();
      });

      expect(app.getPathname()).toMatch(/^\/orchard\/pear/);
      expect([...mounted].sort()).toEqual(['map', 'sheet']);
    });
  });
});

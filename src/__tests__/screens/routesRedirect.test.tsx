/**
 * Scenario: the Insights tab used to live at `/routes`, and notifications scheduled before the
 * rename still carry that path, so it can arrive over any screen, a map detail screen with its
 * sheet among them.
 *
 * Expected behaviour: `/routes` lands on `/insights` with its query intact, through the tab
 * navigator already in the stack, as a link to `/insights` itself does. Nothing it opened over is
 * left beneath: a map detail host is taken down with its sheet, since a native sheet left
 * presented under the tab bar draws over it.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, Tabs } from 'expo-router';

import RoutesRedirectScreen from '@/app/routes';
import {
  createMapSheetHostLayout,
  MapSheetHostMap,
  MapSheetHostSheet,
} from '@/shared/app/MapSheetHost';
import { useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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

function GardenMap() {
  useMountedAs('map');
  return (
    <MapSheetHostMap panel={null}>
      <Text>map</Text>
    </MapSheetHostMap>
  );
}

function GardenSheet() {
  useMountedAs('sheet');
  return (
    <MapSheetHostSheet>
      <Text>card</Text>
    </MapSheetHostSheet>
  );
}

let app: Awaited<ReturnType<typeof renderRouter>>;

async function openFeed() {
  app = await renderRouter(
    {
      _layout: () => <Stack />,
      '(tabs)/_layout': () => <Tabs />,
      '(tabs)/index': () => <Text>feed</Text>,
      '(tabs)/insights': () => <Text>insights</Text>,
      'section/[id]/_layout': createMapSheetHostLayout('section'),
      'section/[id]/index': GardenMap,
      'section/[id]/sheet': GardenSheet,
      routes: () => <RoutesRedirectScreen />,
    },
    { initialUrl: '/' }
  );
}

type RouteNode = { name: string; params?: object; state?: { routes: RouteNode[] } };

/** The names of the root stack's screens, in order. */
function rootStack(): string[] {
  const root = (app.getRouterState()?.routes ?? []) as RouteNode[];
  const stack = root[0]?.name === '__root' ? (root[0].state?.routes ?? []) : root;
  return stack.map((route) => route.name);
}

/** The params the insights tab was opened with. */
function insightsParams(): object | undefined {
  const find = (routes: RouteNode[]): RouteNode | undefined =>
    routes.reduce<RouteNode | undefined>(
      (found, route) =>
        found ?? (route.name === 'insights' ? route : find(route.state?.routes ?? [])),
      undefined
    );
  return find((app.getRouterState()?.routes ?? []) as RouteNode[])?.params;
}

beforeEach(() => {
  mounted.clear();
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
});

it('sends a bare /routes to the insights tab', async () => {
  await openFeed();
  await act(() => router.push('/routes'));

  expect(app.getPathname()).toBe('/insights');
  expect(rootStack()).toEqual(['(tabs)']);
});

it('carries the sub-tab and an insight id through', async () => {
  await openFeed();
  await act(() => router.push('/routes?tab=insights&insightId=ins-7'));

  expect(app.getPathname()).toBe('/insights');
  expect(insightsParams()).toEqual({ tab: 'insights', insightId: 'ins-7' });
});

it('takes down a section screen and its sheet it arrives over', async () => {
  await openFeed();
  await act(() => router.push('/section/plum'));
  expect([...mounted].sort()).toEqual(['map', 'sheet']);

  await act(() => router.push('/routes?tab=sections'));

  expect(app.getPathname()).toBe('/insights');
  expect(insightsParams()).toEqual({ tab: 'sections' });
  expect(rootStack()).toEqual(['(tabs)']);
  expect(mounted.size).toBe(0);
  expect(useMapSheetHosts.getState().hosts).toEqual({});
});

it('redirects once, not on every render', async () => {
  await openFeed();
  const redirects = jest.spyOn(router, 'dismissTo');
  try {
    await act(() => router.push('/routes?tab=routes'));

    expect(redirects).toHaveBeenCalledTimes(1);
    expect(app.getPathname()).toBe('/insights');
  } finally {
    redirects.mockRestore();
  }
});

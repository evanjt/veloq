/**
 * Scenario: a row inside a map sheet opens another detail subject, under a real router. The
 * subject goes into the same sheet as a card on top of the one the row sits in, rather than as a
 * second screen with a second sheet stacked over the first.
 *
 * Expected behaviour: the push adds a card to the host's stack and no screen to either stack;
 * the pushed card carries the close control and the root card does not; closing it, or Android's
 * back, shows the card below as it was left; back from the root leaves the screen in one press. A
 * subject the host has no card for, and a row outside a sheet, open the detail screen.
 */

import React, { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import {
  createMapSheetHostLayout,
  MapSheetHostMap,
  MapSheetHostSheet,
  useMapSheetCardAddress,
} from '@/shared/app/MapSheetHost';
import {
  MapSheetCards,
  useOpenDetail,
  type MapSheetCardProps,
  type MapSheetCardRegistry,
} from '@/shared/app/MapSheetCards';
import { patchHostCard, topCard, useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';
import { stubHardwareBack, type HardwareBack } from '../__shared__/hardwareBack';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 1366 };
const mockWindow = { size: PHONE };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ ...mockWindow.size, scale: 3, fontScale: 1 }),
}));

/** A route card: a counter of its own, a picked attempt in its state, and rows that open. */
function OrchardRouteCard({ id }: MapSheetCardProps) {
  const [visits, setVisits] = useState(0);
  const { hostKey, index } = useMapSheetCardAddress('route', id);
  const open = useOpenDetail();
  return (
    <>
      <Text testID="orchard-route-card">{`route:${id}:${visits}`}</Text>
      <Pressable testID="orchard-route-visit" onPress={() => setVisits((n) => n + 1)} />
      <Pressable
        testID="orchard-route-pick"
        onPress={() => patchHostCard(hostKey, index, { attemptId: 'a_dawn' })}
      />
      <Pressable
        testID="orchard-route-open-section"
        onPress={() => open({ kind: 'section', id: 'quince', params: { activityId: 'a_dawn' } })}
      />
      <Pressable
        testID="orchard-route-open-activity"
        onPress={() => open({ kind: 'activity', id: 'a_dawn' })}
      />
    </>
  );
}

function OrchardSectionCard({ id, params }: MapSheetCardProps) {
  const open = useOpenDetail();
  return (
    <>
      <Text testID="orchard-section-card">{`section:${id}:${params.activityId ?? ''}`}</Text>
      <Pressable
        testID="orchard-section-open-route"
        onPress={() => open({ kind: 'route', id: 'medlar' })}
      />
    </>
  );
}

const REGISTRY: MapSheetCardRegistry = { route: OrchardRouteCard, section: OrchardSectionCard };

function OrchardMap() {
  return (
    <MapSheetHostMap panel={<MapSheetCards registry={REGISTRY} rootParams={{}} />}>
      <Text testID="orchard-map">map</Text>
    </MapSheetHostMap>
  );
}

function OrchardSheet() {
  return (
    <MapSheetHostSheet>
      <MapSheetCards registry={REGISTRY} rootParams={{}} />
    </MapSheetHostSheet>
  );
}

/** A screen outside any sheet with a row that opens a section. */
function Feed() {
  const open = useOpenDetail();
  return (
    <Pressable testID="feed-open-section" onPress={() => open({ kind: 'section', id: 'quince' })}>
      <Text>feed</Text>
    </Pressable>
  );
}

function SectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Text testID="section-screen">{id}</Text>;
}

function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Text testID="activity-screen">{id}</Text>;
}

let app: Awaited<ReturnType<typeof renderRouter>>;
const originalOS = Platform.OS;

async function openOrchard() {
  app = await renderRouter(
    {
      _layout: () => <Stack />,
      index: Feed,
      'orchard/[id]/_layout': createMapSheetHostLayout('route'),
      'orchard/[id]/index': OrchardMap,
      'orchard/[id]/sheet': OrchardSheet,
      'section/[id]': SectionScreen,
      'activity/[id]': ActivityScreen,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push('/orchard/pear'));
}

/** The host over the feed, with its map and its sheet, and nothing over either. */
const HOST_STACKS = { root: ['index', 'orchard/[id]'], nested: ['index', 'sheet'] };

type RouteNode = { name: string; state?: { routes: RouteNode[] } };

/** The names of the root stack's screens, and of the host's nested stack, in order. */
function stacks(): { root: string[]; nested: string[] } {
  const top = (app.getRouterState()?.routes ?? []) as RouteNode[];
  // The router wraps the root stack in a `__root` route of its own.
  const root = top[0]?.name === '__root' ? (top[0].state?.routes ?? []) : top;
  const host = root.find((route) => route.name === 'orchard/[id]');
  return {
    root: root.map((route) => route.name),
    nested: (host?.state?.routes ?? []).map((route) => route.name),
  };
}

function cards() {
  return useMapSheetHosts.getState().hosts['route:pear']?.cards ?? [];
}

async function press(testID: string) {
  await act(async () => fireEvent.press(app.getByTestId(testID)));
}

beforeEach(() => {
  mockWindow.size = PHONE;
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
});

afterEach(() => {
  Platform.OS = originalOS;
});

describe('a row inside a map sheet', () => {
  it('pushes its subject as a card into the same sheet and pushes no screen', async () => {
    await openOrchard();
    const before = stacks();

    await press('orchard-route-open-section');

    expect(stacks()).toEqual(before);
    expect(before).toEqual(HOST_STACKS);
    expect(cards().map((card) => `${card.kind}:${card.id}`)).toEqual([
      'route:pear',
      'section:quince',
    ]);
    expect(app.getByTestId('orchard-section-card')).toHaveTextContent('section:quince:a_dawn');
    expect(app.queryByTestId('orchard-route-card')).toBeNull();
  });

  it('gives the pushed card the close control and the root card none', async () => {
    await openOrchard();
    expect(app.queryByTestId('map-sheet-card-close')).toBeNull();

    await press('orchard-route-open-section');

    expect(app.getByTestId('map-sheet-card-close')).toHaveProp(
      'accessibilityLabel',
      'maps.closeSectionCard'
    );
  });

  it('closes the card on its close control, showing the card below as it was left', async () => {
    await openOrchard();
    await press('orchard-route-visit');
    await press('orchard-route-visit');
    await press('orchard-route-pick');
    await press('orchard-route-open-section');

    await press('map-sheet-card-close');

    expect(cards()).toHaveLength(1);
    expect(app.getByTestId('orchard-route-card')).toHaveTextContent('route:pear:2');
    expect(topCard(useMapSheetHosts.getState().hosts, 'route:pear')?.state).toEqual({
      attemptId: 'a_dawn',
    });
    expect(app.queryByTestId('map-sheet-card-close')).toBeNull();
    expect(stacks()).toEqual(HOST_STACKS);
  });

  it('pushes deeper from a pushed card and closes one card at a time', async () => {
    await openOrchard();
    await press('orchard-route-open-section');
    await press('orchard-section-open-route');

    expect(app.getByTestId('orchard-route-card')).toHaveTextContent('route:medlar:0');

    await press('map-sheet-card-close');
    expect(app.getByTestId('orchard-section-card')).toBeTruthy();
    await press('map-sheet-card-close');
    expect(app.getByTestId('orchard-route-card')).toHaveTextContent('route:pear:0');
  });

  it('opens a subject the host has no card for as its own screen', async () => {
    await openOrchard();

    await press('orchard-route-open-activity');

    expect(app.getPathname()).toBe('/activity/a_dawn');
    expect(cards()).toHaveLength(1);
  });

  it('opens the detail screen from a row outside a sheet', async () => {
    app = await renderRouter(
      { _layout: () => <Stack />, index: Feed, 'section/[id]': SectionScreen },
      { initialUrl: '/' }
    );

    await press('feed-open-section');

    expect(app.getPathname()).toBe('/section/quince');
    expect(app.getByTestId('section-screen')).toHaveTextContent('quince');
  });

  it('pushes and closes cards in the side panel of a tablet-width window too', async () => {
    mockWindow.size = TABLET;
    await openOrchard();
    expect(stacks().nested).toEqual(['index']);

    await press('orchard-route-open-section');
    expect(app.getByTestId('orchard-section-card')).toBeTruthy();
    expect(stacks().nested).toEqual(['index']);

    await press('map-sheet-card-close');
    expect(app.getByTestId('orchard-route-card')).toBeTruthy();
  });

  describe('on Android', () => {
    let back: HardwareBack;

    beforeEach(() => {
      Platform.OS = 'android';
      back = stubHardwareBack();
    });

    afterEach(() => back.restore());

    it('pops one card on back with two, then leaves the screen on the next', async () => {
      await openOrchard();
      await press('orchard-route-open-section');

      await act(async () => {
        expect(back.press()).toBe(true);
      });

      expect(cards()).toHaveLength(1);
      expect(stacks()).toEqual(HOST_STACKS);
      expect(app.getByTestId('orchard-route-card')).toBeTruthy();

      await act(async () => {
        expect(back.press()).toBe(true);
      });

      expect(app.getPathname()).toBe('/');
      expect(useMapSheetHosts.getState().hosts).toEqual({});
    });

    it('leaves the screen in one press of back with only the root card', async () => {
      await openOrchard();

      await act(async () => {
        expect(back.press()).toBe(true);
      });

      expect(app.getPathname()).toBe('/');
    });

    it('pops only the screen covering the host, leaving its cards', async () => {
      await openOrchard();
      await press('orchard-route-open-section');
      await press('orchard-section-open-route');
      await act(() => router.push('/section/elder'));

      await act(async () => {
        back.press();
      });

      expect(stacks()).toEqual(HOST_STACKS);
      expect(cards()).toHaveLength(3);
    });
  });
});

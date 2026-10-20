/**
 * Scenario: a map detail screen is open with its sheet, under a real router, and a link, a push
 * or a replace names a subject of the same kind, another one or the one already open. The host's
 * route on the root stack is one name for every subject (`trail/[id]`), which the router compared
 * by name alone, so the second subject landed inside the open host's nested stack: its map
 * screen came back without the sheet, and the host went on reading the first subject.
 *
 * Expected behaviour: another subject opens a host of its own over the first, with its map
 * screen and its sheet reading that subject, and back returns to the first with its sheet. A
 * link to the subject already open leaves its host as it was, sheet presented. A replace takes
 * the open host's place with the new subject's.
 */

import React, { useEffect } from 'react';
import { Platform, Text } from 'react-native';
import { act } from '@testing-library/react-native';
// Before the testing library, whose own link mock would otherwise be the one the router keeps.
import 'expo-linking';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';

import {
  createMapSheetHostLayout,
  MapSheetHostMap,
  MapSheetHostSheet,
  useMapSheetHost,
} from '@/shared/app/MapSheetHost';
import { useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';
import { stubHardwareBack } from '../__shared__/hardwareBack';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

// A phone's window, where the host presents its sheet rather than a side panel.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

type UrlListener = (event: { url: string }) => void;
const mockUrlListeners: UrlListener[] = [];
jest.mock('expo-linking', () => {
  const actual = jest.requireActual('expo-linking');
  return {
    ...actual,
    addEventListener: (type: string, listener: UrlListener) => {
      if (type === 'url') mockUrlListeners.push(listener);
      return {
        remove: () => {
          const at = mockUrlListeners.indexOf(listener);
          if (at >= 0) mockUrlListeners.splice(at, 1);
        },
      };
    },
  };
});

const mounted = new Set<string>();

function useMountedAs(name: string) {
  useEffect(() => {
    mounted.add(name);
    return () => {
      mounted.delete(name);
    };
  }, [name]);
}

function TrailMap() {
  const host = useMapSheetHost();
  useMountedAs(`map:${host?.id}`);
  return (
    <MapSheetHostMap panel={<TrailCard />}>
      <Text>map</Text>
    </MapSheetHostMap>
  );
}

function TrailCard() {
  return <Text testID="trail-card">{useMapSheetHost()?.id}</Text>;
}

function TrailSheet() {
  useMountedAs(`sheet:${useMapSheetHost()?.id}`);
  return (
    <MapSheetHostSheet>
      <TrailCard />
    </MapSheetHostSheet>
  );
}

const TRAIL = 'trail/[id]';

let app: Awaited<ReturnType<typeof renderRouter>>;

async function openTrail(id: string) {
  app = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>feed</Text>,
      'trail/[id]/_layout': createMapSheetHostLayout('activity'),
      'trail/[id]/index': TrailMap,
      'trail/[id]/sheet': TrailSheet,
    },
    { initialUrl: '/' }
  );
  await act(async () => {
    await jest.runAllTimersAsync();
  });
  await act(() => router.push(`/trail/${id}`));
}

/** Opens `path` the way the system hands the app a link while it is open. */
async function openLink(path: string) {
  await act(async () => {
    for (const listener of [...mockUrlListeners]) listener({ url: `veloq://${path.slice(1)}` });
  });
}

type RouteNode = {
  name: string;
  params?: { id?: string };
  state?: { index?: number; routes: RouteNode[] };
};

/** The root stack's screens, each a name, the host's subject, and its nested stack. */
function rootStack(): { name: string; id: string | undefined; nested: string[] }[] {
  const root = (app.getRouterState()?.routes ?? []) as RouteNode[];
  const stack = root[0]?.state?.routes ?? [];
  return stack.map((route) => ({
    name: route.name,
    id: route.params?.id,
    nested: (route.state?.routes ?? []).map((nested) => nested.name),
  }));
}

/** What the host in front shows: its subject, and the subject its nested map screen reads. */
function frontHost(): { id: string | undefined; screens: (string | undefined)[] } {
  const root = (app.getRouterState()?.routes ?? []) as RouteNode[];
  const stack = root[0]?.state;
  const front = stack?.routes[stack.index ?? stack.routes.length - 1];
  return {
    id: front?.params?.id,
    screens: (front?.state?.routes ?? []).map((route) => route.params?.id),
  };
}

beforeEach(() => {
  mounted.clear();
  mockUrlListeners.length = 0;
  useMapSheetHosts.setState({ hosts: {} });
  useMapSheetStops.setState({ sheets: {}, presenters: {} });
});

describe('a second subject from an open map host', () => {
  it('opens a link to another subject in a host of its own, with its sheet', async () => {
    await openTrail('larch');
    expect(mockUrlListeners.length).toBeGreaterThan(0);

    await openLink('/trail/spruce');

    expect(rootStack()).toEqual([
      { name: 'index', id: undefined, nested: [] },
      { name: TRAIL, id: 'larch', nested: ['index', 'sheet'] },
      { name: TRAIL, id: 'spruce', nested: ['index', 'sheet'] },
    ]);
    expect(frontHost()).toEqual({ id: 'spruce', screens: ['spruce', 'spruce'] });
    expect([...mounted].sort()).toEqual(['map:larch', 'map:spruce', 'sheet:larch', 'sheet:spruce']);
    expect(Object.keys(useMapSheetHosts.getState().hosts).sort()).toEqual([
      'activity:larch',
      'activity:spruce',
    ]);
  });

  it('returns to the first subject with its sheet on Android back', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    const back = stubHardwareBack();
    try {
      await openTrail('larch');
      await openLink('/trail/spruce');

      await act(async () => {
        expect(back.press()).toBe(true);
      });
    } finally {
      back.restore();
      Platform.OS = originalOS;
    }

    expect(app.getPathname()).toMatch(/^\/trail\/larch/);
    expect(rootStack().at(-1)).toEqual({ name: TRAIL, id: 'larch', nested: ['index', 'sheet'] });
    expect([...mounted].sort()).toEqual(['map:larch', 'sheet:larch']);
  });

  it('opens each subject of a run of links with its sheet', async () => {
    await openTrail('larch');

    for (const id of ['spruce', 'cedar']) await openLink(`/trail/${id}`);

    expect(frontHost()).toEqual({ id: 'cedar', screens: ['cedar', 'cedar'] });
    expect(rootStack().at(-1)?.nested).toEqual(['index', 'sheet']);
  });

  it('leaves the host as it was, sheet presented, on a link to the subject already open', async () => {
    await openTrail('larch');

    await openLink('/trail/larch');

    expect(rootStack()).toEqual([
      { name: 'index', id: undefined, nested: [] },
      { name: TRAIL, id: 'larch', nested: ['index', 'sheet'] },
    ]);
    expect([...mounted].sort()).toEqual(['map:larch', 'sheet:larch']);
  });

  it('opens another subject pushed from inside the host in a host of its own', async () => {
    await openTrail('larch');

    await act(() => router.push('/trail/spruce'));

    expect(rootStack().map(({ id, nested }) => ({ id, nested }))).toEqual([
      { id: undefined, nested: [] },
      { id: 'larch', nested: ['index', 'sheet'] },
      { id: 'spruce', nested: ['index', 'sheet'] },
    ]);
    expect(frontHost()).toEqual({ id: 'spruce', screens: ['spruce', 'spruce'] });
  });

  it('takes the open host’s place on a replace with another subject', async () => {
    await openTrail('larch');

    await act(() => router.replace('/trail/spruce'));

    expect(rootStack().map(({ id, nested }) => ({ id, nested }))).toEqual([
      { id: undefined, nested: [] },
      { id: 'spruce', nested: ['index', 'sheet'] },
    ]);
    expect([...mounted].sort()).toEqual(['map:spruce', 'sheet:spruce']);
  });
});

/**
 * Scenario: a click on the heatmap of the connect page's global map asks the engine what lies
 * under the point, and the panel lists the engine's answer.
 *
 * Expected behaviour: the ask carries the point and the camera's whole zoom inside the heatmap's
 * range; the activity rows are the activities the engine listed, each once, newest first, and an
 * activity whose bounds hold the point but which the engine did not list has no row; the kind
 * filter offers only the kinds present, with their counts, and narrows the group rows; each group
 * row shows its sports and its last date.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MapScreen } from '../../../web/connect/map/MapScreen';
import {
  activityRows,
  groupRows,
  kindOptions,
  underPointAsk,
  type UnderPointAnswer,
} from '../../../web/connect/map/underPoint';
import type { Methods } from '../../../web/connect/schema';
import { parse } from '../../../web/connect/router';
import { fakePhone } from '../__shared__/connectPhone';

const activity = (id: string, date: number) => ({
  id,
  name: `ride ${id}`,
  sportType: 'Ride',
  date,
  distance: 10_000,
  duration: 1_800,
  nearestM: 3,
});

const group = (
  kind: 'route' | 'section' | 'noRoute',
  id: string | null,
  activities: ReturnType<typeof activity>[]
) => ({
  kind,
  id,
  name: null,
  number: kind === 'route' ? 1 : null,
  count: activities.length,
  sportTypes: [],
  distanceM: 0,
  passes: 0,
  bestTime: null,
  lastDate: null,
  activities,
});

const answer = (
  groups: ReturnType<typeof group>[],
  activities: ReturnType<typeof activity>[] = []
): UnderPointAnswer => ({
  total: activities.length,
  truncated: false,
  traceCap: 100,
  groups,
  activities,
});

describe('the ask for a click on the heatmap', () => {
  it('names the point as latitude and longitude and the camera as a whole zoom', () => {
    expect(underPointAsk([7.35, 46.2], 14.9)).toEqual({
      latitude: 46.2,
      longitude: 7.35,
      zoom: 14,
    });
  });

  it('keeps the zoom inside the heatmap range', () => {
    expect(underPointAsk([7.35, 46.2], 0.4).zoom).toBe(1);
    expect(underPointAsk([7.35, 46.2], 21).zoom).toBe(17);
  });
});

describe('the rows of the engine answer', () => {
  const listed = answer(
    [
      group('route', 'g1', [activity('a', 100), activity('b', 300)]),
      group('section', 's1', [activity('b', 300), activity('c', 200)]),
    ],
    [activity('b', 300), activity('c', 200), activity('a', 100)]
  );

  it('lists each activity the engine named once, newest first, and no other', () => {
    expect(activityRows(listed).map((a) => a.id)).toEqual(['b', 'c', 'a']);
    expect(activityRows(answer([]))).toEqual([]);
  });

  it('offers the kinds present with their counts, and none when one kind is all there is', () => {
    expect(kindOptions(listed)).toEqual([
      { kind: 'all', count: 3 },
      { kind: 'routes', count: 1 },
      { kind: 'sections', count: 1 },
      { kind: 'activities', count: 3 },
    ]);
    expect(kindOptions(answer([group('route', 'g1', [activity('a', 1)])]))).toEqual([]);
    expect(kindOptions(answer([]))).toEqual([]);
  });

  it('narrows the group rows to a kind', () => {
    expect(groupRows(listed, 'routes').map((g) => g.id)).toEqual(['g1']);
    expect(groupRows(listed, 'sections').map((g) => g.id)).toEqual(['s1']);
    expect(groupRows(listed, 'all').map((g) => g.id)).toEqual(['g1', 's1']);
    expect(groupRows(listed, 'activities')).toEqual([]);
  });
});

const METHODS = ['map.screen', 'heatmap.underPoint'];

const POINT: [number, number] = [7.35, 46.2];

// The engine's answer lists `near` only. `boxed` has a bounding box that holds the point, so a
// list built from the boxes would show it, and the page must not.
const listedActivity = {
  id: 'near',
  name: 'ride near',
  sportType: 'Ride',
  date: 1_700_000_000,
  distance: 10_000,
  duration: 1_800,
  nearestM: 3,
};

const UNDER_POINT: Methods['heatmap.underPoint']['result'] = {
  total: 1,
  truncated: false,
  traceCap: 100,
  groups: [
    {
      kind: 'route',
      id: 'r1',
      name: 'Lakeside loop',
      number: 1,
      count: 1,
      sportTypes: ['Ride'],
      distanceM: 12_000,
      passes: 2,
      bestTime: 1_500,
      lastDate: 1_700_000_000,
      activities: [listedActivity],
    },
  ],
  activities: [listedActivity],
};

const mapActivity = (
  activityId: string,
  date: number,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
) => ({
  activityId,
  sportType: 'Ride',
  isVirtual: false,
  bounds,
  startLat: 46.18,
  startLng: 7.33,
  date,
  name: `ride ${activityId}`,
  distance: 10_000,
  duration: 1_800,
});

const MAP_SCREEN: Methods['map.screen']['result'] = {
  screen: {
    activityCount: 2,
    availableSportTypes: ['Ride'],
    categoryCounts: [{ family: 'ride', count: 2 }],
    activities: [
      mapActivity('near', 1_700_000_000, {
        minLat: 46.18,
        maxLat: 46.22,
        minLng: 7.33,
        maxLng: 7.37,
      }),
      mapActivity('boxed', 1_690_000_000, {
        minLat: 46.19,
        maxLat: 46.21,
        minLng: 7.34,
        maxLng: 7.36,
      }),
    ],
    routeCount: 1,
    routeLines: null,
    sectionCount: 0,
    sections: null,
    emptyReason: null,
    unmapped: { withoutGps: 0, downloading: 0 },
  },
  routeGeneration: 1,
  sectionStamp: 1,
};

const mockPane = jest.fn();
jest.mock('../../../web/connect/map/MapPane', () => ({
  MapPane: (props: unknown) => {
    mockPane(props);
    return null;
  },
}));

const lastPane = () =>
  mockPane.mock.calls.at(-1)?.[0] as { onPoint: (at: [number, number]) => void };

const settle = async () => {
  for (let at = 0; at < 3; at += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

/** A page open on `hash`: the phone it reads from, and the renderer once it is mounted. */
async function open(hash: string) {
  const stand = fakePhone((method) => {
    if (method === 'map.screen') return MAP_SCREEN;
    if (method === 'heatmap.underPoint') return UNDER_POINT;
    throw new Error(`no read of ${method}`);
  }, METHODS);
  Object.defineProperty(globalThis, 'location', { value: { hash }, configurable: true });
  const page = { stand, root: null as ReactTestRenderer | null };
  await draw(page);
  return page;
}

/** The page drawn from the address as it stands, updating the renderer when one is mounted. */
async function draw(page: Page) {
  const element = (
    <MapScreen
      queries={page.stand.queries}
      methods={METHODS}
      route={parse(globalThis.location.hash)}
    />
  );
  await act(async () => {
    if (page.root) page.root.update(page.stand.wrap(element));
    else page.root = create(page.stand.wrap(element));
  });
  await settle();
  return page.root as ReactTestRenderer;
}

type Page = Awaited<ReturnType<typeof open>>;

/** A click on the heatmap at `at`, then the page drawn again from the address the click wrote. */
async function clickPoint(page: Page, at: [number, number]) {
  await act(async () => {
    lastPane().onPoint(at);
  });
  return draw(page);
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const panel = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.type === 'aside' && node.props.id === 'map-selection')[0];

const tableIn = (root: ReactTestRenderer, label: string) =>
  panel(root).findAll((node) => node.type === 'table' && node.props['aria-label'] === label)[0];

const rowsOf = (table: ReactTestInstance | undefined) =>
  table ? table.findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined) : [];

describe('a click on the heatmap of the global map', () => {
  it('asks the engine for the point, with the camera zoom', async () => {
    const page = await open('#/map');
    await clickPoint(page, POINT);
    expect(page.stand.callsOf('heatmap.underPoint').at(-1)?.params).toEqual(
      expect.objectContaining({ latitude: 46.2, longitude: 7.35 })
    );
  });

  it('lists the activities the engine named and no activity whose box holds the point', async () => {
    const page = await open('#/map');
    const root = await clickPoint(page, POINT);
    const activityRowsShown = rowsOf(tableIn(root, 'maps.layerActivities')).map(
      (row) => row.props['data-row']
    );
    expect(activityRowsShown).toEqual(['near']);
  });

  it('lists each group with its sports and last date', async () => {
    const page = await open('#/map');
    const root = await clickPoint(page, POINT);
    const [groupRow] = rowsOf(tableIn(root, 'maps.layerRoutes'));
    expect(groupRow?.props['data-row']).toBe('route:r1');
    const cells = (groupRow as ReactTestInstance)
      .findAll((node) => node.type === 'td')
      .map((cell) => textOf(cell));
    expect(cells).toEqual(expect.arrayContaining(['Ride', '2023-11-14']));
  });
});

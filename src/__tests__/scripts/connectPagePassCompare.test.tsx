/**
 * Scenario: two passes of a section are selected on the section page, the
 * selection being the `ids` the address carries.
 *
 * Expected behaviour: each selected pass row carries a swatch in its compare
 * colour, and the map slot draws one overlay path per selected pass in that
 * colour. The page reads each selected pass's stream once, and a page without
 * the selection draws neither.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RoutesPage } from '../../../web/connect/RoutesPage';
import type { Route } from '../../../web/connect/router';
import type { Session } from '../../../web/connect/session';
import vectors from '../../../modules/veloqrs/rust/veloqrs/tests/fixtures/track_codec_vectors.json';

type Case = { name: string; bytes: number[] };

const TRACK = Buffer.from(
  (vectors.cases as Case[]).find((entry) => entry.name === 'every point carries elevation')
    ?.bytes ?? []
).toString('base64');

const LIST = {
  groups: [],
  filteredGroupCount: 0,
  hasMoreGroups: false,
  sections: [
    {
      id: 's1',
      name: 'Col',
      distanceMeters: 1000,
      visitCount: 3,
      sportTypes: ['Ride'],
    },
  ],
  filteredSectionCount: 1,
  hasMoreSections: false,
};

const PASS = (activityId: string, movingTime: number, startTime: number) => ({
  activityId,
  name: activityId,
  sportType: 'Ride',
  startTime,
  distance: 1000,
  movingTime,
  averageSpeed: 3,
});

const DETAIL = {
  activityCount: 3,
  section: { id: 's1', name: 'Col', distanceMeters: 1000, sectionType: 'auto' },
  activityRows: [
    PASS('p1', 300, 1_700_000_000),
    PASS('p2', 280, 1_700_100_000),
    PASS('p3', 310, 1_700_200_000),
  ],
  history: [],
  geometryVersions: [],
  mergeCandidates: [],
};

function fakeSession(): Session {
  const read = async (method: string) => {
    if (method === 'routes.screen') return LIST;
    if (method === 'section.detail') return DETAIL;
    if (method === 'activity.streams') return { latlng: TRACK };
    throw new Error(`unexpected read ${method}`);
  };
  return { read: jest.fn(read) } as unknown as Session;
}

async function settle() {
  for (let at = 0; at < 4; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function sectionAt(ids: string | null): Route {
  return {
    screen: 'section',
    id: 's1',
    query: ids === null ? [] : [['ids', ids]],
  };
}

/** Each row that carries a swatch, with the swatch's colour class. */
const swatches = (root: ReactTestRenderer) =>
  root.root
    .findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined)
    .flatMap((row) =>
      row
        .findAll(
          (node) => node.type === 'span' && String(node.props.className).startsWith('swatch')
        )
        .map((node) => ({
          row: row.props['data-row'],
          colour: String(node.props.className).replace('swatch ', ''),
        }))
    );

const overlays = (root: ReactTestRenderer) =>
  root.root
    .findAll((node) => node.type === 'path' && node.props['data-compared'] !== undefined)
    .map((node) => node.props['data-compared']);

describe('the section page with two passes selected', () => {
  it('shows a swatch on each selected pass and an overlay path for each', async () => {
    const session = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<RoutesPage session={session} route={sectionAt('p1,p2')} />);
    });
    await settle();
    expect(swatches(root)).toEqual([
      { row: 'p2', colour: 'line-1' },
      { row: 'p1', colour: 'line-0' },
    ]);
    expect(overlays(root)).toEqual(['p1', 'p2']);
    const streamReads = (session.read as jest.Mock).mock.calls.filter(
      ([method]) => method === 'activity.streams'
    );
    expect(streamReads.map(([, params]) => params.id)).toEqual(['p1', 'p2']);
    root.unmount();
  });

  it('draws neither a swatch nor an overlay without a selection', async () => {
    const session = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<RoutesPage session={session} route={sectionAt(null)} />);
    });
    await settle();
    expect(swatches(root)).toEqual([]);
    expect(overlays(root)).toEqual([]);
    expect(session.read).not.toHaveBeenCalledWith('activity.streams', expect.anything());
    root.unmount();
  });
});

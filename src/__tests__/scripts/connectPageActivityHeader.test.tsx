/**
 * Scenario: the activity page is opened from a link for a ride the feed has not
 * loaded, so no feed row for it is held.
 *
 * Expected behaviour: the name, date, sport and figures come from the engine's
 * record for the activity; the header reads its untitled label and shows no
 * figures until that record has answered.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ActivityPage } from '../../../web/connect/pages/ActivityPage';
import type { FfiActivityRecord } from '../../../web/connect/schema';
import type { Detail } from '../../../web/connect/feedReads';
import { PageNameContext } from '../../../web/connect/shell/pageName';

const RECORD = {
  id: 'run-9',
  isDetail: false,
  name: 'Harbour sprint',
  sportType: 'Run',
  startDateLocal: '2026-03-04T18:05:00',
  description: null,
  deviceName: null,
  movingTime: 1_320,
  distance: 5_000,
  elevationGain: 12,
  avgHr: null,
  maxHr: null,
  avgPower: null,
  trainingLoad: null,
} as unknown as FfiActivityRecord;

const DETAIL: Detail = {
  id: 'run-9',
  movingTime: 1_320,
  elapsedTime: 1_400,
  averageSpeed: 3.79,
  maxSpeed: 5.1,
};

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

/** Mounts the page under the shell's name setter, so what the page reports to the top bar can be read. */
async function mount(element: React.ReactElement, names: (name: string | null) => void) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(<PageNameContext.Provider value={names}>{element}</PageNameContext.Provider>);
  });
  return root;
}

const byId = (root: ReactTestRenderer, id: string) => textOf(root.root.findByProps({ id }));

const statValues = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.type === 'dd').map(textOf);

describe('the activity page header', () => {
  it('hands the record name to the top bar and draws the date and sport from the record', async () => {
    const names = jest.fn();
    const root = await mount(
      <ActivityPage id="run-9" record={RECORD} detail={DETAIL} data={null} />,
      names
    );
    expect(names).toHaveBeenLastCalledWith('Harbour sprint');
    expect(byId(root, 'activity-when')).toBe('2026-03-04 18:05 · Run');
  });

  it('draws the distance and climbing from the record in the stat cards', async () => {
    const root = await mount(
      <ActivityPage id="run-9" record={RECORD} detail={DETAIL} data={null} />,
      jest.fn()
    );
    expect(statValues(root)).toContain('5.0 km');
    expect(statValues(root)).toContain('12 m');
  });

  it('hands the top bar no name and shows no figures before the record answers', async () => {
    const names = jest.fn();
    const root = await mount(
      <ActivityPage id="run-9" record={undefined} detail={DETAIL} data={null} />,
      names
    );
    expect(names).toHaveBeenLastCalledWith(null);
    expect(statValues(root)).toEqual([]);
  });
});

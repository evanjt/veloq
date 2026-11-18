/**
 * Scenario: the activity page offers its one-off actions in a header of at
 * most two actions and a menu, and every setting of the activity in a Manage
 * panel, against a stand-in phone.
 *
 * Expected behaviour: the header holds at most two primary actions and one
 * menu button; the menu lists the export and Manage; the Manage panel holds the
 * heatmap switch and one switch for each route and section the activity matched,
 * each write goes through the shared editor and names the reads it changes, and
 * Undo on the toast puts back what the switch changed.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ActivityPage } from '../../../web/connect/pages/ActivityPage';
import type { DetailData } from '../../../web/connect/activity';
import type { FfiActivityRecord } from '../../../web/connect/schema';
import { WriteToasts } from '../../../web/connect/shell/WriteToasts';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('../../../web/connect/map/ActivityMap', () => ({ ActivityMap: () => null }));

const RECORD = {
  id: 'ride-3',
  name: 'Lake loop',
  sportType: 'Ride',
  startDateLocal: '2026-05-02T08:15:00',
  movingTime: 3_600,
  distance: 24_900,
} as unknown as FfiActivityRecord;

type Membership = { kind: 'route' | 'section'; id: string; name: string; excluded: boolean };

const WRITES = new Set([
  'heatmap.setHidden',
  'route.excludeActivity',
  'route.includeActivity',
  'section.excludeActivity',
  'section.includeActivity',
]);

/** A phone whose activity detail answers with the state its writes have left. */
function session(refuse?: string) {
  const state = {
    hidden: false,
    memberships: [
      { kind: 'route', id: 'loop', name: 'Lake loop', excluded: false },
      { kind: 'section', id: 'hill', name: 'Hill', excluded: false },
      { kind: 'section', id: 'col', name: 'Col', excluded: true },
    ] as Membership[],
  };
  const writes: [string, unknown][] = [];
  const phone = fakePhone(async (method, params) => {
    if (WRITES.has(method)) {
      if (refuse) throw new Error(refuse);
      writes.push([method, params]);
      const p = params as { id?: string; hidden?: boolean };
      if (method === 'heatmap.setHidden') state.hidden = p.hidden === true;
      else {
        state.memberships = state.memberships.map((m) =>
          m.id === p.id ? { ...m, excluded: method.endsWith('excludeActivity') } : m
        );
      }
      return { ok: true };
    }
    if (method === 'activity.detail') {
      return { hasGpsTrack: true, intervalsId: 'i42', heatmapHidden: state.hidden, ...state };
    }
    return { text: '', ok: true };
  });
  return { phone, writes };
}

const DETAIL = { hasGpsTrack: true, intervalsId: 'i42', heatmapHidden: false } as DetailData;

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as { window?: unknown }).window = {
    location: { hash: '#/activity/ride-3', assign: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
});

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(phone: ReturnType<typeof session>['phone']) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      phone.wrap(
        <WriteToasts>
          <ActivityPage
            id="ride-3"
            record={RECORD}
            detail={undefined}
            detailData={DETAIL}
            data={null}
            queries={phone.queries}
          />
        </WriteToasts>
      )
    );
  });
  await settle();
  return root;
}

const hosts = (node: ReactTestRenderer | ReactTestInstance, type: string) =>
  ('root' in node ? node.root : node).findAll((n) => n.type === type);
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const header = (root: ReactTestRenderer) => root.root.findAllByProps({ id: 'activity-header' })[0]!;
const menuButton = (root: ReactTestRenderer) =>
  hosts(header(root), 'button').find((b) => b.props['aria-haspopup'] === 'menu')!;

async function openManage(root: ReactTestRenderer) {
  await act(async () => menuButton(root).props.onClick());
  const manage = hosts(root, 'button').find(
    (b) => b.props.role === 'menuitem' && textOf(b) === 'connectPage.activity.manage'
  )!;
  await act(async () => manage.props.onClick());
  await settle();
}

/** The switch labelled `name` in the Manage panel. */
function switchOf(root: ReactTestRenderer, name: string) {
  const label = hosts(root, 'label').find((l) => textOf(l).includes(name));
  if (!label) throw new Error(`no switch ${name}`);
  return hosts(label, 'input')[0]!;
}

async function flip(root: ReactTestRenderer, name: string, checked: boolean) {
  await act(async () => switchOf(root, name).props.onChange({ currentTarget: { checked } }));
  await settle();
}

async function undo(root: ReactTestRenderer) {
  const press = hosts(root, 'button').find((b) => textOf(b) === 'common.undo')!;
  await act(async () => press.props.onClick());
  await settle();
}

describe('the activity header', () => {
  it('holds at most two primary actions and one menu, with the export and Manage in the menu', async () => {
    const { phone } = session();
    const root = await mount(phone);
    const buttons = hosts(header(root), 'button');
    const links = hosts(header(root), 'a');
    expect(buttons.filter((b) => b.props['aria-haspopup'] === 'menu')).toHaveLength(1);
    expect(buttons.length + links.length - 1).toBeLessThanOrEqual(2);
    expect(buttons.map(textOf)).not.toContain('connectPage.activity.exportGpx');
    expect(hosts(header(root), 'input')).toHaveLength(0);

    await act(async () => menuButton(root).props.onClick());
    const items = hosts(root, 'button')
      .filter((b) => b.props.role === 'menuitem')
      .map(textOf);
    expect(items).toEqual(['connectPage.activity.exportGpx', 'connectPage.activity.manage']);
  });
});

describe('the activity header without a track', () => {
  it('lists Manage alone in its menu, as there is no track to export', async () => {
    const { phone } = session();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(
          <ActivityPage
            id="ride-3"
            record={RECORD}
            detail={undefined}
            detailData={{ ...DETAIL, hasGpsTrack: false } as DetailData}
            data={null}
            queries={phone.queries}
          />
        )
      );
    });
    await settle();
    await act(async () => menuButton(root).props.onClick());
    const items = hosts(root, 'button')
      .filter((b) => b.props.role === 'menuitem')
      .map(textOf);
    expect(items).toEqual(['connectPage.activity.manage']);
  });
});

describe('the Manage panel', () => {
  it('stays closed until Manage is chosen, then holds the heatmap and one switch for each route and section', async () => {
    const { phone } = session();
    const root = await mount(phone);
    expect(hosts(root, 'label').filter((l) => hosts(l, 'input').length > 0)).toHaveLength(0);
    await openManage(root);
    expect(switchOf(root, 'connectPage.activity.showOnHeatmap').props.checked).toBe(true);
    expect(switchOf(root, 'Lake loop').props.checked).toBe(true);
    expect(switchOf(root, 'Hill').props.checked).toBe(true);
    expect(switchOf(root, 'Col').props.checked).toBe(false);
    const panel = hosts(root, 'section').find((n) => n.props.id === 'activity-manage')!;
    expect(panel.props.role).toBe('region');
  });

  it('hides the activity from the heatmap through the switch, and Undo shows it again', async () => {
    const { phone, writes } = session();
    const root = await mount(phone);
    await openManage(root);
    await flip(root, 'connectPage.activity.showOnHeatmap', false);
    expect(writes).toEqual([['heatmap.setHidden', { activityId: 'ride-3', hidden: true }]]);
    expect(switchOf(root, 'connectPage.activity.showOnHeatmap').props.checked).toBe(false);
    await undo(root);
    expect(writes[1]).toEqual(['heatmap.setHidden', { activityId: 'ride-3', hidden: false }]);
    expect(switchOf(root, 'connectPage.activity.showOnHeatmap').props.checked).toBe(true);
  });

  it('leaves the activity out of one section, and Undo takes it back in', async () => {
    const { phone, writes } = session();
    const root = await mount(phone);
    await openManage(root);
    await flip(root, 'Hill', false);
    expect(writes).toEqual([['section.excludeActivity', { id: 'hill', activityId: 'ride-3' }]]);
    expect(switchOf(root, 'Hill').props.checked).toBe(false);
    await undo(root);
    expect(writes[1]).toEqual(['section.includeActivity', { id: 'hill', activityId: 'ride-3' }]);
    expect(switchOf(root, 'Hill').props.checked).toBe(true);
  });

  it('takes the activity back into a section it was left out of, and out of a route', async () => {
    const { phone, writes } = session();
    const root = await mount(phone);
    await openManage(root);
    await flip(root, 'Col', true);
    await flip(root, 'Lake loop', false);
    expect(writes).toEqual([
      ['section.includeActivity', { id: 'col', activityId: 'ride-3' }],
      ['route.excludeActivity', { id: 'loop', activityId: 'ride-3' }],
    ]);
  });

  it('shows the engine’s refusal and leaves the switch where it was', async () => {
    const { phone } = session('not now');
    const root = await mount(phone);
    await openManage(root);
    await flip(root, 'Hill', false);
    expect(root.root.findAll((n) => n.props.role === 'alert').map((n) => textOf(n))).toContain(
      'not now'
    );
    expect(switchOf(root, 'Hill').props.checked).toBe(true);
  });

  it('closes on Escape and from its close button', async () => {
    const { phone } = session();
    const root = await mount(phone);
    await openManage(root);
    const panel = () => hosts(root, 'section').find((n) => n.props.id === 'activity-manage');
    await act(async () =>
      panel()!.props.onKeyDown({
        key: 'Escape',
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      })
    );
    expect(panel()).toBeUndefined();
    await openManage(root);
    const close = hosts(panel()!, 'button').find((b) => textOf(b) === 'common.close')!;
    await act(async () => close.props.onClick());
    expect(panel()).toBeUndefined();
  });
});

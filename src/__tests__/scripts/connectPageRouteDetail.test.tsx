/**
 * Scenario: a route's detail on the desktop page draws its attempts as a table with a gap to the
 * fastest and a rank, and as charts, and the athlete excludes several attempts at once.
 *
 * Expected behaviour: selecting two rows and pressing the bulk exclude sends one
 * `route.excludeActivity` per row and shows a single toast with an undo; the undo sends one
 * `route.includeActivity` per row and takes the toast away; a refused write shows the engine's
 * text and no toast; a dot picked on the over-time chart selects its row in the table; the
 * context menu on the attempts table sets the reference to the attempt it was opened on, or hands
 * the reference back, and with no row under the pointer offers no attempt to set.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { RoutesPage } from '../../../web/connect/pages/RoutesPage';
import type { Route } from '../../../web/connect/router';
import { ContextMenu, ToastProvider } from '../../../web/connect/ui';
import { fakePhone } from '../__shared__/connectPhone';

const DAY = 86_400;

const ATTEMPTS = {
  best: { activityId: 'p2' },
  performances: [
    { activityId: 'p1', name: 'Mon', date: 1_700_000_000, speed: 4, movingTime: 700 },
    { activityId: 'p2', name: 'Tue', date: 1_700_000_000 + DAY, speed: 5, movingTime: 600 },
    { activityId: 'p3', name: 'Wed', date: 1_700_000_000 + 2 * DAY, speed: 4.5, movingTime: 650 },
    { activityId: 'p4', name: 'Thu', date: 1_700_000_000 + 3 * DAY, speed: 4.2, movingTime: 680 },
  ],
  histograms: { forward: { startSecs: 600, binWidthSecs: 30, counts: [1, 1, 2] }, reverse: null },
};

const PERFORMANCE = {
  chartData: {
    points: ATTEMPTS.performances.map((p) => ({
      activityId: p.activityId,
      activityName: p.name,
      activityDate: p.date,
      speed: p.speed,
      sectionTime: p.movingTime,
      isBest: p.activityId === 'p2',
    })),
  },
  histograms: ATTEMPTS.histograms,
  trendCurves: { forwardTime: null },
  recordProgression: { forward: [], reverse: [] },
  curves: null,
};

const WRITES = new Set([
  'route.excludeActivity',
  'route.includeActivity',
  'route.rename',
  'route.setReference',
  'route.resetReference',
]);

function fakeSession(refuse?: string, performance: unknown = PERFORMANCE) {
  const writes: [string, { activityId: string; id?: string }][] = [];
  const phone = fakePhone((method, params) => {
    if (WRITES.has(method)) {
      if (refuse) throw new Error(refuse);
      writes.push([method, params as { activityId: string; id?: string }]);
      return { ok: true };
    }
    switch (method) {
      case 'routes.screen':
        return {
          groups: [],
          filteredGroupCount: 0,
          hasMoreGroups: false,
          sections: [],
          filteredSectionCount: 0,
          hasMoreSections: false,
        };
      case 'route.detail':
        return {
          activityCount: 4,
          group: { customName: 'Loop' },
          distanceMeters: 1000,
          elevationGainMeters: 10,
          excludedActivityIds: [],
        };
      case 'route.attempts':
        return ATTEMPTS;
      case 'route.performance':
        return performance;
      default:
        throw new Error(`unexpected read ${method}`);
    }
  });
  return { phone, writes };
}

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(node: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(node);
  });
  await settle();
  return root;
}

const route: Route = { screen: 'route', id: 'r1', query: [] };

beforeAll(() => {
  // The page writes the address when the selection changes.
  Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true });
});

const page = (session: ReturnType<typeof fakeSession>) =>
  session.phone.wrap(
    <ToastProvider dismissLabel="dismiss">
      <RoutesPage route={route} />
    </ToastProvider>
  );

const rowOf = (root: ReactTestRenderer, id: string): ReactTestInstance =>
  root.root.findAll((node) => node.type === 'tr' && node.props['data-row'] === id)[0] as never;

const click = (row: ReactTestInstance, modifier: 'ctrl' | 'none') =>
  act(async () => {
    row.props.onClick({
      shiftKey: false,
      ctrlKey: modifier === 'ctrl',
      metaKey: false,
      stopPropagation: () => undefined,
    });
  });

const buttonLabelled = (root: ReactTestRenderer, key: string) =>
  root.root.findAll(
    (node) => node.type === 'button' && node.findAll((n) => n.children.includes(key)).length > 0
  )[0] as ReactTestInstance;

const toasts = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.type === 'div' && node.props.className === 'ui-toast');

async function selectTwoAndExclude(root: ReactTestRenderer) {
  await click(rowOf(root, 'p3'), 'none');
  await click(rowOf(root, 'p4'), 'ctrl');
  await act(async () => {
    buttonLabelled(root, 'connectPage.routes.excludeSelected').props.onClick();
  });
  await settle();
}

describe('excluding attempts from a route', () => {
  it('sends one exclude per selected row and shows one toast, and its undo includes them again', async () => {
    const session = fakeSession();
    const root = await mount(page(session));
    await selectTwoAndExclude(root);

    expect(session.writes.map(([method, params]) => [method, params.activityId]).sort()).toEqual([
      ['route.excludeActivity', 'p3'],
      ['route.excludeActivity', 'p4'],
    ]);
    expect(toasts(root)).toHaveLength(1);

    session.writes.length = 0;
    await act(async () => {
      buttonLabelled(root, 'connectPage.routes.undo').props.onClick();
    });
    await settle();
    expect(session.writes.map(([method, params]) => [method, params.activityId]).sort()).toEqual([
      ['route.includeActivity', 'p3'],
      ['route.includeActivity', 'p4'],
    ]);
    expect(toasts(root)).toHaveLength(0);
    root.unmount();
  });

  it('shows the engine refusal and no toast when the phone refuses', async () => {
    const session = fakeSession('that attempt is the reference');
    const root = await mount(page(session));
    await selectTwoAndExclude(root);
    const alerts = root.root.findAll((node) => node.props.role === 'alert');
    expect(alerts.map((node) => node.children)).toContainEqual(['that attempt is the reference']);
    expect(toasts(root)).toHaveLength(0);
    root.unmount();
  });
});

describe('the over-time chart', () => {
  it("draws the engine's forward trend band through the answered points, with no regression of its own", async () => {
    const trend = [0, 1, 2, 3].map((day) => ({
      time: 1_700_000_000 + day * DAY,
      value: 650 - day * 12,
      lower: 640 - day * 12,
      upper: 660 - day * 12,
    }));
    const session = fakeSession(undefined, {
      ...PERFORMANCE,
      trendCurves: { forwardTime: trend },
    });
    const root = await mount(page(session));
    const curves = root.root.findAll(
      (node) => node.type === 'path' && node.props.className === 'curve-line'
    );
    expect(curves).toHaveLength(1);
    expect(String(curves[0]!.props.d).match(/[ML]/g)).toHaveLength(trend.length);
    expect(
      root.root.findAll((node) => node.type === 'path' && node.props.className === 'curve-band')
    ).toHaveLength(1);
    expect(
      root.root.findAll((node) => node.type === 'line' && node.props.className === 'trend-line')
    ).toHaveLength(0);
    root.unmount();
  });
});

describe('the attempts table', () => {
  it('gives each row its gap to the fastest and its rank', async () => {
    const session = fakeSession();
    const root = await mount(page(session));
    const cells = (id: string) =>
      rowOf(root, id)
        .findAll((node) => node.type === 'td')
        .map((td) =>
          td.findAll((n) => typeof n.children[0] === 'string').map((n) => n.children[0])
        );
    const flat = (id: string) => cells(id).flat();
    expect(flat('p2')).toContain('1');
    expect(flat('p1')).toContain('4');
    root.unmount();
  });

  it('selects the row of a dot picked on the over-time chart', async () => {
    const session = fakeSession();
    const root = await mount(page(session));
    const dots = root.root.findAll(
      (node) => node.type === 'circle' && String(node.props.className).startsWith('mark-dot')
    );
    expect(dots.length).toBeGreaterThanOrEqual(4);
    await act(async () => {
      dots[2]?.props.onClick();
    });
    await settle();
    expect(rowOf(root, 'p3').props['aria-selected']).toBe(true);
    expect(rowOf(root, 'p2').props['aria-selected']).toBe(false);
    root.unmount();
  });
});

describe('the attempts table context menu', () => {
  const wrapper = (root: ReactTestRenderer) =>
    root.root.findAll((node) => node.props.onContextMenuCapture !== undefined)[0] as never as {
      props: { onContextMenuCapture: (event: unknown) => void };
    };
  const menuItems = (root: ReactTestRenderer) =>
    (
      root.root.findByType(ContextMenu).props as {
        items: { id: string; disabled?: boolean; onSelect: () => void }[];
      }
    ).items;
  const openOn = (root: ReactTestRenderer, row: string | null) =>
    act(async () => {
      wrapper(root).props.onContextMenuCapture({
        target: { closest: () => (row === null ? null : { getAttribute: () => row }) },
      });
    });

  it('sets the reference to the attempt under the pointer', async () => {
    const session = fakeSession();
    const root = await mount(page(session));
    await openOn(root, 'p3');
    await act(async () => {
      menuItems(root)
        .find((item) => item.id === 'setReference')
        ?.onSelect();
    });
    await settle();
    expect(session.writes).toEqual([['route.setReference', { id: 'r1', activityId: 'p3' }]]);
    root.unmount();
  });

  it('offers no attempt to set when the pointer is off the rows, and still hands the reference back', async () => {
    const session = fakeSession();
    const root = await mount(page(session));
    await openOn(root, null);
    expect(menuItems(root).find((item) => item.id === 'setReference')?.disabled).toBe(true);
    await act(async () => {
      menuItems(root)
        .find((item) => item.id === 'resetReference')
        ?.onSelect();
    });
    await settle();
    expect(session.writes).toEqual([['route.resetReference', { id: 'r1' }]]);
    root.unmount();
  });
});

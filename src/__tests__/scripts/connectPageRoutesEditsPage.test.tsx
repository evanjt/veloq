/**
 * Scenario: the section and route panes and the activity's heatmap switch
 * offer the engine's edits against a fake link.
 *
 * Expected behaviour: each affordance sends its write method with the params
 * the engine asks, the pane asks its reads again after an `ok`, and a refusal
 * shows the engine's text with no further read.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HeatmapSwitch } from '../../../web/connect/pages/ActivityPage';
import { RoutesPage } from '../../../web/connect/pages/RoutesPage';
import type { Route } from '../../../web/connect/router';
import { WriteToasts } from '../../../web/connect/shell/WriteToasts';
import { fakePhone } from '../__shared__/connectPhone';

const SECTION = {
  id: 's1',
  name: 'Col',
  distanceMeters: 1000,
  sectionType: 'auto',
  isLift: false,
  disabled: false,
  isUserDefined: false,
};

const SECTION_DETAIL = {
  activityCount: 1,
  section: SECTION,
  activityRows: [
    {
      activityId: 'p1',
      name: 'p1',
      sportType: 'Ride',
      startTime: 1_700_000_000,
      distance: 1000,
      movingTime: 300,
      averageSpeed: 3,
    },
  ],
  history: [],
  geometryVersions: [],
  mergeCandidates: [],
  excludedActivityIds: ['gone1'],
};

const ROUTE_DETAIL = {
  activityCount: 1,
  group: { customName: 'Loop' },
  distanceMeters: 1000,
  elevationGainMeters: 10,
  excludedActivityIds: ['gone1'],
};

const ATTEMPTS = {
  best: { activityId: 'p1' },
  performances: [{ activityId: 'p1', name: 'p1', date: 1_700_000_000, speed: 3, movingTime: 300 }],
};

const WRITES = new Set([
  'section.rename',
  'section.setLift',
  'section.disable',
  'section.accept',
  'section.excludeActivity',
  'section.includeActivity',
  'route.rename',
  'route.excludeActivity',
  'route.includeActivity',
  'heatmap.setHidden',
]);

/**
 * A held write stays out until `release` answers it: `null` for an ok, a text
 * for the engine's refusal.
 */
function fakeSession(refuse?: string, hold = false) {
  const reads: string[] = [];
  const writes: [string, unknown][] = [];
  const named = { name: SECTION.name };
  const held: { release: (refusal: string | null) => void } = { release: () => undefined };
  const phone = fakePhone(async (method, params) => {
    if (WRITES.has(method)) {
      if (hold) {
        await new Promise<void>((resolve, reject) => {
          held.release = (refusal) => (refusal === null ? resolve() : reject(new Error(refusal)));
        });
      }
      if (refuse) throw new Error(refuse);
      writes.push([method, params]);
      if (method === 'section.rename') named.name = (params as { name: string }).name;
      return { ok: true };
    }
    reads.push(method);
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
      case 'section.detail':
        return { ...SECTION_DETAIL, section: { ...SECTION, name: named.name } };
      case 'route.detail':
        return ROUTE_DETAIL;
      case 'route.attempts':
        return ATTEMPTS;
      case 'activity.detail':
        return { heatmapHidden: false };
      case 'section.performance':
      case 'route.performance':
        return {
          chartData: { points: [] },
          histograms: { forward: null, reverse: null },
          recordProgression: { forward: [], reverse: [] },
          trendCurves: { forwardTime: null },
          curves: null,
          curvesPending: false,
        };
      case 'section.history':
        return { history: [], geometryVersions: [], pinnedVersion: null, names: [] };
      default:
        throw new Error(`unexpected read ${method}`);
    }
  });
  return { phone, reads, writes, held };
}

/** The heatmap switch given the phone the way the activity page gives it. */
function Switch() {
  return <HeatmapSwitch id="a1" />;
}

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  await settle();
  return root;
}

const sectionRoute: Route = { screen: 'section', id: 's1', query: [] };
const routeRoute: Route = { screen: 'route', id: 'r1', query: [] };

/** The button whose label is the translation key, as no catalogue is loaded here. */
const button = (root: ReactTestRenderer, key: string) => {
  const found = root.root.findAll(
    (node) => node.type === 'button' && node.findAll((n) => n.children.includes(key)).length > 0
  );
  if (found.length === 0) throw new Error(`no button ${key}`);
  return found[0];
};

async function press(root: ReactTestRenderer, key: string) {
  await act(async () => {
    button(root, key).props.onClick({ stopPropagation: () => undefined });
  });
  await settle();
}

async function rename(root: ReactTestRenderer, name: string) {
  const input = root.root.findByProps({ className: 'rename' }).findByType('input');
  await act(async () => {
    input.props.onChange({ currentTarget: { value: name } });
  });
  await act(async () => {
    root.root.findByProps({ className: 'rename' }).props.onSubmit({ preventDefault: () => {} });
  });
  await settle();
}

/** Selects the row with a plain click, as the table's own handler reads it. */
async function selectRow(root: ReactTestRenderer, id: string) {
  const row = root.root.findAll((node) => node.type === 'tr' && node.props['data-row'] === id)[0];
  await act(async () => {
    row?.props.onClick({
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      stopPropagation: () => undefined,
    });
  });
}

const count = (reads: string[], method: string) => reads.filter((r) => r === method).length;

describe('the section pane edits', () => {
  it('sends each edit and reads the detail again after each ok', async () => {
    const { phone, reads, writes } = fakeSession();
    const root = await mount(phone.wrap(<RoutesPage route={sectionRoute} />));
    expect(count(reads, 'section.detail')).toBe(1);

    await rename(root, 'Climb');
    await press(root, 'connectPage.routes.lift');
    await press(root, 'connectPage.routes.enabled');
    await press(root, 'connectPage.routes.actionAccept');
    await press(root, 'connectPage.routes.actionExcludePass');
    await press(root, 'connectPage.routes.actionInclude');

    expect(writes).toEqual([
      ['section.rename', { id: 's1', name: 'Climb' }],
      ['section.setLift', { id: 's1', isLift: true }],
      ['section.disable', { id: 's1' }],
      ['section.accept', { id: 's1' }],
      ['section.excludeActivity', { id: 's1', activityId: 'p1' }],
      ['section.includeActivity', { id: 's1', activityId: 'gone1' }],
    ]);
    expect(count(reads, 'section.detail')).toBe(1 + writes.length);
    root.unmount();
  });

  it('shows the engine refusal and does not read again', async () => {
    const { phone, reads } = fakeSession('that name is already used');
    const root = await mount(phone.wrap(<RoutesPage route={sectionRoute} />));
    await rename(root, 'Climb');
    const alerts = root.root.findAll((node) => node.props.role === 'alert');
    expect(alerts.map((node) => node.children)).toContainEqual(['that name is already used']);
    expect(count(reads, 'section.detail')).toBe(1);
    root.unmount();
  });
});

describe('the optimistic section rename', () => {
  const heading = (root: ReactTestRenderer) =>
    root.root
      .findAll((node) => node.type === 'h3' && node.props.className === 'panel-title')[0]
      .children.join('');

  it('shows the new name while the write is out, and the old one again when the phone refuses', async () => {
    const { phone, reads, held } = fakeSession(undefined, true);
    const root = await mount(phone.wrap(<RoutesPage route={sectionRoute} />));
    expect(heading(root)).toBe('Col');

    await rename(root, 'Climb');
    expect(heading(root)).toBe('Climb');

    await act(async () => {
      held.release('that name is already used');
    });
    await settle();
    expect(heading(root)).toBe('Col');
    expect(
      root.root.findAll((node) => node.props.role === 'alert').map((node) => node.children)
    ).toContainEqual(['that name is already used']);
    expect(count(reads, 'section.detail')).toBe(1);
    root.unmount();
  });

  it('keeps the new name once the phone answers, and reads the detail again', async () => {
    const { phone, reads, held } = fakeSession(undefined, true);
    const root = await mount(phone.wrap(<RoutesPage route={sectionRoute} />));
    await rename(root, 'Climb');
    await act(async () => {
      held.release(null);
    });
    await settle();
    expect(heading(root)).toBe('Climb');
    expect(count(reads, 'section.detail')).toBe(2);
    root.unmount();
  });
});

describe('the route pane edits', () => {
  beforeAll(() => {
    // The page writes the address when the selection changes.
    Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true });
  });

  it('renames and excludes through the route methods, reading again after each', async () => {
    const { phone, reads, writes } = fakeSession();
    const root = await mount(phone.wrap(<RoutesPage route={routeRoute} />));
    await rename(root, 'Lap');
    await selectRow(root, 'p1');
    await press(root, 'connectPage.routes.excludeSelected');
    await selectRow(root, 'gone1');
    await press(root, 'connectPage.routes.includeSelected');
    expect(writes).toEqual([
      ['route.rename', { id: 'r1', name: 'Lap' }],
      ['route.excludeActivity', { id: 'r1', activityId: 'p1' }],
      ['route.includeActivity', { id: 'r1', activityId: 'gone1' }],
    ]);
    expect(count(reads, 'route.detail')).toBe(1 + writes.length);
    root.unmount();
  });
});

describe('the activity heatmap switch', () => {
  it('hides the activity then reads its state again, and shows a refusal', async () => {
    const { phone, reads, writes } = fakeSession();
    const root = await mount(phone.wrap(<Switch />));
    await press(root, 'connectPage.activity.hideFromHeatmap');
    expect(writes).toEqual([['heatmap.setHidden', { activityId: 'a1', hidden: true }]]);
    expect(count(reads, 'activity.detail')).toBe(2);
    root.unmount();

    const refused = fakeSession('not now');
    const again = await mount(refused.phone.wrap(<Switch />));
    await press(again, 'connectPage.activity.hideFromHeatmap');
    expect(
      again.root.findAll((n) => n.props.role === 'alert').map((n) => n.children)
    ).toContainEqual(['not now']);
    expect(count(refused.reads, 'activity.detail')).toBe(1);
    again.unmount();
  });

  it('shows an undo toast for a hide, and undo sends the inverse and reads the state again', async () => {
    const { phone, reads, writes } = fakeSession();
    const root = await mount(
      phone.wrap(
        <WriteToasts>
          <Switch />
        </WriteToasts>
      )
    );
    await press(root, 'connectPage.activity.hideFromHeatmap');
    const toasts = () =>
      root.root.findAll(
        (node) => node.type === 'span' && node.children.includes('connectPage.undo.hidden')
      );
    expect(toasts()).toHaveLength(1);

    await press(root, 'common.undo');
    expect(writes).toEqual([
      ['heatmap.setHidden', { activityId: 'a1', hidden: true }],
      ['heatmap.setHidden', { activityId: 'a1', hidden: false }],
    ]);
    expect(count(reads, 'activity.detail')).toBe(3);
    expect(toasts()).toHaveLength(0);
    root.unmount();
  });
});

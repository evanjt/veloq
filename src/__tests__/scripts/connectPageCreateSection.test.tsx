/**
 * Scenario: the activity page cuts a section from the ride on screen.
 *
 * Expected behaviour: Create section opens a panel whose range is the whole ride until the
 * charts are brushed; a brush on the charts, the two grips on the map and the distances typed
 * into the fields all set the same range; Create sends one `section.create` with that index
 * range, the ride's sport and the name, and the toast's undo takes the new section out with
 * `section.disable`. Five points are the least a section keeps, so a range tighter than that
 * cannot be created, and Escape closes the panel and sends nothing.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ActivityPage } from '../../../web/connect/pages/ActivityPage';
import type { DetailData } from '../../../web/connect/activity';
import type { ChartData } from '../../../web/connect/chart';
import type { FfiActivityRecord } from '../../../web/connect/schema';
import { ToastProvider } from '../../../web/connect/ui';
import { fakePhone } from '../__shared__/connectPhone';

type MapProps = {
  range?: { from: number; to: number } | null;
  create?: {
    labels: { start: string; end: string };
    onRange: (range: { from: number; to: number }) => void;
  } | null;
};

let mapProps: MapProps | null = null;

jest.mock('../../../web/connect/map/ActivityMap', () => ({
  ActivityMap: (props: MapProps) => {
    mapProps = props;
    return null;
  },
}));

const RECORD = {
  id: 'ride-3',
  name: 'Lake loop',
  sportType: 'Ride',
  startDateLocal: '2026-05-02T08:15:00',
} as unknown as FfiActivityRecord;

const DETAIL = { hasGpsTrack: true, intervalsId: null, provenance: null } as unknown as DetailData;

const SAMPLES = 600;
const DATA: ChartData = {
  time: Array.from({ length: SAMPLES }, (_, i) => i * 6),
  distance: Array.from({ length: SAMPLES }, (_, i) => i * 40),
  series: { altitude: Array.from({ length: SAMPLES }, (_, i) => 400 + i * 0.1) },
};

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const writes: [string, unknown][] = [];
const phone = fakePhone((method, params) => {
  if (method === 'section.create') {
    writes.push([method, params]);
    return { sectionId: 'section-new' };
  }
  if (method === 'section.disable') {
    writes.push([method, params]);
    return { ok: true };
  }
  return { text: '', heatmapHidden: false, ok: true };
});

async function mount() {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  mapProps = null;
  writes.length = 0;
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      phone.wrap(
        <ToastProvider dismissLabel="dismiss">
          <ActivityPage
            id="ride-3"
            record={RECORD}
            detail={undefined}
            detailData={DETAIL}
            data={DATA}
            queries={phone.queries}
          />
        </ToastProvider>
      ),
      { createNodeMock: () => ({ getBoundingClientRect: () => ({ width: 640, left: 0 }) }) }
    );
  });
  return root;
}

const hosts = (root: ReactTestRenderer | ReactTestInstance, type: string) =>
  ('root' in root ? root.root : root).findAll((node) => node.type === type);
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const byId = (root: ReactTestRenderer, id: string) => root.root.findAllByProps({ id });
const buttonOf = (root: ReactTestRenderer, label: string) =>
  hosts(root, 'button').find((b) => textOf(b).includes(label))!;
const press = async (root: ReactTestRenderer, label: string) => {
  await act(async () => buttonOf(root, label).props.onClick());
  for (let at = 0; at < 6; at += 1) await act(async () => Promise.resolve());
};

const chartSvg = (root: ReactTestRenderer) =>
  hosts(root, 'svg').find((svg) => svg.props.role === 'group' && svg.props['aria-label'])!;
const pixelAt = (root: ReactTestRenderer, fraction: number) => {
  const rect = hosts(chartSvg(root), 'rect')[0]!;
  return Number(rect.props.x) + fraction * Number(rect.props.width);
};
const pointer = (clientX: number) => ({
  clientX,
  button: 0,
  pointerId: 1,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0 }),
    setPointerCapture: () => undefined,
  },
});

const field = (root: ReactTestRenderer, label: string) =>
  hosts(root, 'input').find(
    (input) => input.parent?.findAll((n) => n.children.includes(label)).length
  )!;
const typeInto = async (root: ReactTestRenderer, label: string, text: string) => {
  const input = field(root, label);
  await act(async () => input.props.onChange({ currentTarget: { value: text } }));
  await act(async () => field(root, label).props.onKeyDown({ key: 'Enter' }));
};

const keys: ((event: { key: string }) => void)[] = [];

beforeEach(() => {
  keys.length = 0;
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, listener: (event: { key: string }) => void) => {
      if (type === 'keydown') keys.push(listener);
    },
    removeEventListener: () => undefined,
  };
});
afterEach(() => delete (globalThis as { window?: unknown }).window);

describe('cutting a section from the activity page', () => {
  it('opens on the whole ride and hands the map two grips over that range', async () => {
    const root = await mount();
    expect(byId(root, 'create-section')).toHaveLength(0);
    expect(mapProps?.create ?? null).toBeNull();
    await press(root, 'connectPage.activity.createSection');
    expect(byId(root, 'create-section').length).toBeGreaterThan(0);
    expect(mapProps?.range).toEqual({ from: 0, to: SAMPLES - 1 });
    expect(mapProps?.create?.labels.start).toBe('connectPage.activity.createStartHandle');
  });

  it('sends the brushed index range, the sport and the name, and undoes the section it made', async () => {
    const root = await mount();
    await press(root, 'connectPage.activity.createSection');
    await act(async () => chartSvg(root).props.onPointerDown(pointer(pixelAt(root, 0.25))));
    await act(async () => chartSvg(root).props.onPointerMove(pointer(pixelAt(root, 0.5))));
    await act(async () => chartSvg(root).props.onPointerUp(pointer(pixelAt(root, 0.5))));
    const brushed = mapProps!.range!;
    expect(brushed.to).toBeGreaterThan(brushed.from);

    await act(async () =>
      field(root, 'connectPage.routes.name').props.onChange({ currentTarget: { value: ' Climb ' } })
    );
    await press(root, 'connectPage.activity.createSave');
    expect(writes).toEqual([
      [
        'section.create',
        {
          activityId: 'ride-3',
          startIndex: brushed.from,
          endIndex: brushed.to,
          sport: 'Ride',
          name: 'Climb',
        },
      ],
    ]);
    expect(byId(root, 'create-section')).toHaveLength(0);

    await press(root, 'connectPage.sections.undo');
    expect(writes[1]).toEqual(['section.disable', { id: 'section-new' }]);
  });

  it('sends the range the grips were dragged to, with no name when none was typed', async () => {
    const root = await mount();
    await press(root, 'connectPage.activity.createSection');
    await act(async () => mapProps!.create!.onRange({ from: 120, to: 340 }));
    expect(mapProps?.range).toEqual({ from: 120, to: 340 });
    await press(root, 'connectPage.activity.createSave');
    expect(writes[0]).toEqual([
      'section.create',
      { activityId: 'ride-3', startIndex: 120, endIndex: 340, sport: 'Ride', name: null },
    ]);
  });

  it('moves an end to the sample nearest the distance typed in, and keeps the five points between them', async () => {
    const root = await mount();
    await press(root, 'connectPage.activity.createSection');
    await typeInto(root, 'connectPage.activity.createStart', '2.0');
    expect(mapProps?.range?.from).toBe(50);
    await typeInto(root, 'connectPage.activity.createEnd', '2.04');
    expect(mapProps?.range).toEqual({ from: 50, to: 54 });
    await press(root, 'connectPage.activity.createSave');
    expect(writes[0]?.[1]).toMatchObject({ startIndex: 50, endIndex: 54 });
  });

  it('refuses a range under five points', async () => {
    const root = await mount();
    await press(root, 'connectPage.activity.createSection');
    await act(async () => mapProps!.create!.onRange({ from: 100, to: 102 }));
    expect(buttonOf(root, 'connectPage.activity.createSave').props.disabled).toBe(true);
    expect(root.root.findAll((node) => node.props.role === 'alert')).not.toHaveLength(0);
    await press(root, 'connectPage.activity.createSave');
    expect(writes).toEqual([]);
  });

  it('closes on Escape and on Cancel and sends nothing', async () => {
    const root = await mount();
    await press(root, 'connectPage.activity.createSection');
    expect(keys.length).toBeGreaterThan(0);
    await act(async () => {
      for (const listener of keys) listener({ key: 'Escape' });
    });
    expect(byId(root, 'create-section')).toHaveLength(0);
    await press(root, 'connectPage.activity.createSection');
    await press(root, 'connectPage.sections.cancel');
    expect(byId(root, 'create-section')).toHaveLength(0);
    expect(writes).toEqual([]);
  });

  it('offers no way to cut a ride that has no track', async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(
          <ToastProvider dismissLabel="dismiss">
            <ActivityPage
              id="ride-3"
              record={RECORD}
              detail={undefined}
              detailData={{ ...DETAIL, hasGpsTrack: false } as DetailData}
              data={DATA}
              queries={phone.queries}
            />
          </ToastProvider>
        ),
        { createNodeMock: () => ({ getBoundingClientRect: () => ({ width: 640, left: 0 }) }) }
      );
    });
    expect(hosts(root, 'button').map(textOf)).not.toContain('connectPage.activity.createSection');
  });
});

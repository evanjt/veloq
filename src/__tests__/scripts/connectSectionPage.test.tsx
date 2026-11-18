/**
 * Scenario: the section page and the sections list are drawn from the demo
 * library's own answers, and the athlete edits through them.
 *
 * Expected behaviour: the laps table lists each lap of the section; selecting
 * three laps with a shift-click and pressing Exclude sends one
 * `section.excludeLap` write per lap, reads the section again once, and shows
 * one undo that sends the three `section.includeLap` writes back. Accept all
 * on the list asks for confirmation with the count and sends one
 * `section.acceptAll`, whose toast undo sends `section.unaccept` for the ids the
 * engine answered with; accepting one section undoes the same way. The list
 * opens a section from its name.
 *
 * Editing the ends: Edit bounds opens an editor whose end grip, dragged to a position beside
 * the line, snaps to a vertex; Save sends one `section.editBounds` with that index, and the
 * toast's undo reverts to the version live before. Beyond the ends the grips run along the
 * reference ride's track and Save sends an expand over that track's indices. Escape closes the
 * editor and sends nothing. The laps table's context menu sets the reference, and a merge
 * names the rides it leaves out before it is sent.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Histogram } from '../../../web/connect/charts/Histogram';
import { SectionMap, type BoundsEditor } from '../../../web/connect/map/SectionMap';
import { km } from '../../../web/connect/format';
import { pointsOf } from '../../../web/connect/preview';
import { lngLatOf } from '../../../web/connect/sectionBounds';
import { ContextMenu, ToastProvider } from '../../../web/connect/ui';
import { SectionDetailPage } from '../../../web/connect/pages/SectionDetailPage';
import { SectionsPage } from '../../../web/connect/pages/SectionsPage';
import type { Route } from '../../../web/connect/router';
import { demoScript } from '../__shared__/connectDemoLibrary';
import { answerAsk } from '../__shared__/connectPhoneShim';
import { fakePhone } from '../__shared__/connectPhone';

const SCRIPT = demoScript({ browserFingerprint: 'a', phoneProof: 'b', phoneFingerprint: 'c' });

const WRITES = new Set([
  'section.excludeLap',
  'section.includeLap',
  'section.excludeActivity',
  'section.includeActivity',
  'section.acceptAll',
  'section.accept',
  'section.unaccept',
  'section.editBounds',
  'section.merge',
  'section.restore',
  'section.disable',
  'section.delete',
]);

const ACCEPTED_BY_ALL = ['section-3', 'section-5'];

function demoPhone(over: Record<string, unknown> = {}, refuse = false) {
  const writes: [string, unknown][] = [];
  const phone = fakePhone((method, params) => {
    if (WRITES.has(method)) {
      writes.push([method, params]);
      if (method === 'section.merge') return { sectionId: 'section-0', departed: [] };
      if (method === 'section.editBounds') return { ok: !refuse, departed: [] };
      return method === 'section.acceptAll'
        ? { ok: !refuse, ids: ACCEPTED_BY_ALL }
        : { ok: !refuse };
    }
    if (method in over) return over[method];
    const answer = answerAsk(SCRIPT, method, params as Record<string, unknown>);
    if (answer.error !== undefined) throw new Error(answer.error);
    return answer.result;
  });
  return { phone, writes };
}

async function settle() {
  for (let at = 0; at < 8; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(<ToastProvider dismissLabel="dismiss">{element}</ToastProvider>);
  });
  await settle();
  return root;
}

/** The address the page reads its tab from, which the tab strip reads off `window`. */
function addressIs(hash: string) {
  (globalThis as { window?: unknown }).window = {
    location: { hash, assign: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as { document?: unknown }).document = { activeElement: null };
}

/** Unmounted inside `act`, so the tab strip's cleanup runs while the address stub still stands. */
async function unmount(root: ReactTestRenderer) {
  await act(async () => {
    root.unmount();
  });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

const lapsRoute: Route = { screen: 'section', id: 'section-0', query: [['tab', 'laps']] };

const rows = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined);

const click = async (node: ReactTestInstance, keys = {}) => {
  await act(async () => {
    node.props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false, ...keys });
  });
};

const button = (root: ReactTestRenderer, label: string) => {
  const found = root.root.findAll(
    (node) => node.type === 'button' && node.findAll((n) => n.children.includes(label)).length > 0
  );
  if (found.length === 0) throw new Error(`no button ${label}`);
  return found[0];
};

const toasts = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.props.className === 'ui-toast');

describe('the section page laps', () => {
  beforeEach(() => addressIs('#/section/section-0?tab=laps'));

  it('lists a row for each lap the engine holds', async () => {
    const { phone } = demoPhone();
    const performance = SCRIPT.results['section.performance'] as never as {
      lapRecords: { laps: unknown[] }[];
    };
    const root = await mount(phone.wrap(<SectionDetailPage route={lapsRoute} />));
    const laps = (
      (SCRIPT.byActivity?.['section.performance']?.['section-0'] as typeof performance) ??
      performance
    ).lapRecords.flatMap((record) => record.laps);
    expect(laps.length).toBeGreaterThan(3);
    expect(rows(root)).toHaveLength(laps.length);
    await unmount(root);
  });

  it('sends one write per selected lap, reads once, and undoes them with one toast', async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={lapsRoute} />));
    const before = phone.callsOf('section.performance').length;

    await click(rows(root)[0]);
    await click(rows(root)[2], { shiftKey: true });
    await act(async () => {
      button(root, 'connectPage.sections.excludeLaps').props.onClick({});
    });
    await settle();

    const laps = writes.filter(([method]) => method === 'section.excludeLap');
    expect(laps).toHaveLength(3);
    expect(
      new Set(laps.map(([, params]) => (params as { activityId: string }).activityId)).size
    ).toBe(3);
    expect(laps.every(([, params]) => (params as { id: string }).id === 'section-0')).toBe(true);
    expect(phone.callsOf('section.performance').length).toBe(before + 1);
    expect(toasts(root)).toHaveLength(1);

    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    const back = writes.filter(([method]) => method === 'section.includeLap');
    expect(back.map(([, params]) => params)).toEqual(laps.map(([, params]) => params).reverse());
    await unmount(root);
  });

  it('sends nothing when the selected laps are already excluded', async () => {
    const performance = SCRIPT.byActivity?.['section.performance']?.['section-0'] as {
      lapRecords: { laps: { excluded: boolean }[] }[];
    };
    const excluded = {
      ...performance,
      lapRecords: performance.lapRecords.map((record) => ({
        ...record,
        laps: record.laps.map((lap) => ({ ...lap, excluded: true })),
      })),
    };
    const { phone, writes } = demoPhone({ 'section.performance': excluded });
    const root = await mount(phone.wrap(<SectionDetailPage route={lapsRoute} />));
    await click(rows(root)[0]);
    await act(async () => {
      button(root, 'connectPage.sections.excludeLaps').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([]);
    expect(toasts(root)).toHaveLength(0);
    await unmount(root);
  });
});

describe('the section page spread', () => {
  beforeEach(() => addressIs('#/section/section-0?tab=spread'));

  it('draws the engine bins through Histogram', async () => {
    const { phone } = demoPhone();
    const root = await mount(
      phone.wrap(
        <SectionDetailPage
          route={{ screen: 'section', id: 'section-0', query: [['tab', 'spread']] }}
        />
      )
    );
    const drawn = root.root.findAllByType(Histogram);
    expect(drawn).toHaveLength(1);
    const bins = drawn[0]?.props.binned as { low: number; high: number; count: number }[];
    expect(bins.length).toBeGreaterThan(0);
    expect(bins.every((bin) => bin.high > bin.low)).toBe(true);
    await unmount(root);
  });
});

describe('accepting one section', () => {
  const detailRoute: Route = { screen: 'section', id: 'section-0', query: [] };

  beforeEach(() => addressIs('#/section/section-0'));

  it('sends section.accept and its toast undo sends section.unaccept for that section', async () => {
    const detail = SCRIPT.results['section.detail'] as { section: object };
    const { phone, writes } = demoPhone({
      'section.detail': { ...detail, section: { ...detail.section, isUserDefined: false } },
    });
    const root = await mount(phone.wrap(<SectionDetailPage route={detailRoute} />));
    await act(async () => {
      button(root, 'connectPage.routes.actionAccept').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([['section.accept', { id: 'section-0' }]]);
    expect(toasts(root)).toHaveLength(1);

    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    expect(writes[1]).toEqual(['section.unaccept', { ids: ['section-0'] }]);
    await unmount(root);
  });
});

describe('removing one section', () => {
  const detailRoute: Route = { screen: 'section', id: 'section-0', query: [] };

  beforeEach(() => addressIs('#/section/section-0'));

  const withOrigin = (isUserDefined: boolean) => {
    const detail = SCRIPT.results['section.detail'] as { section: object };
    return demoPhone({
      'section.detail': { ...detail, section: { ...detail.section, isUserDefined } },
    });
  };
  const labels = (root: ReactTestRenderer) =>
    root.root
      .findAll((node) => node.type === 'button')
      .flatMap((node) => node.findAll((n) => typeof n.children[0] === 'string'))
      .map((node) => node.children[0]);

  it('offers a detected section Remove, which disables it', async () => {
    const { phone, writes } = withOrigin(false);
    const root = await mount(phone.wrap(<SectionDetailPage route={detailRoute} />));
    expect(labels(root)).not.toContain('sections.deleteSection');
    await act(async () => {
      button(root, 'connectPage.sections.remove').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([['section.disable', { id: 'section-0' }]]);
    await unmount(root);
  });

  it('offers a section the athlete made Delete, and sends it only once confirmed', async () => {
    const { phone, writes } = withOrigin(true);
    const root = await mount(phone.wrap(<SectionDetailPage route={detailRoute} />));
    expect(labels(root)).not.toContain('connectPage.sections.remove');

    await act(async () => {
      button(root, 'sections.deleteSection').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([]);
    const dialog = root.root.findAll((node) => node.props.role === 'dialog')[0];
    expect(
      JSON.stringify(
        dialog.findAll((n) => typeof n.children[0] === 'string').map((n) => n.children)
      )
    ).toContain('sections.deleteSectionConfirm');

    await act(async () => {
      button(root, 'common.delete').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([['section.delete', { id: 'section-0' }]]);
    await unmount(root);
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const { phone, writes } = withOrigin(true);
    const root = await mount(phone.wrap(<SectionDetailPage route={detailRoute} />));
    await act(async () => {
      button(root, 'sections.deleteSection').props.onClick({});
    });
    await act(async () => {
      button(root, 'connectPage.sections.cancel').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([]);
    await unmount(root);
  });
});

describe('the sections list', () => {
  const listRoute: Route = { screen: 'sections', id: null, query: [] };

  beforeEach(() => addressIs('#/sections'));

  it('names the count before accepting every detected section, then sends one write', async () => {
    const screen = { ...(SCRIPT.results['routes.screen'] as object), unacceptedAutoCount: 3 };
    const { phone, writes } = demoPhone({ 'routes.screen': screen });
    const root = await mount(phone.wrap(<SectionsPage route={listRoute} />));
    expect(rows(root).length).toBeGreaterThan(0);

    await act(async () => {
      button(root, 'connectPage.sections.acceptAllCount').props.onClick({});
    });
    const dialog = root.root.findAll((node) => node.props.role === 'dialog')[0];
    expect(
      JSON.stringify(
        dialog.findAll((node) => typeof node.children[0] === 'string').map((n) => n.children)
      )
    ).toContain('connectPage.sections.acceptAllBody');
    expect(writes).toEqual([]);

    await act(async () => {
      button(root, 'connectPage.sections.acceptAll').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([['section.acceptAll', {}]]);

    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    expect(writes).toEqual([
      ['section.acceptAll', {}],
      ['section.unaccept', { ids: ACCEPTED_BY_ALL }],
    ]);
    await unmount(root);
  });

  it('says so, and offers no undo, when the phone does not accept the write', async () => {
    const screen = { ...(SCRIPT.results['routes.screen'] as object), unacceptedAutoCount: 3 };
    const { phone, writes } = demoPhone({ 'routes.screen': screen }, true);
    const root = await mount(phone.wrap(<SectionsPage route={listRoute} />));
    await act(async () => {
      button(root, 'connectPage.sections.acceptAllCount').props.onClick({});
    });
    await act(async () => {
      button(root, 'connectPage.sections.acceptAll').props.onClick({});
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(root.root.findAll((node) => node.props.role === 'alert')).not.toHaveLength(0);
    expect(toasts(root)).toHaveLength(0);
    await unmount(root);
  });

  it('offers no accept all when nothing is waiting for review', async () => {
    const screen = { ...(SCRIPT.results['routes.screen'] as object), unacceptedAutoCount: 0 };
    const { phone } = demoPhone({ 'routes.screen': screen });
    const root = await mount(phone.wrap(<SectionsPage route={listRoute} />));
    expect(button(root, 'connectPage.sections.acceptAllCount').props.disabled).toBe(true);
    await unmount(root);
  });
});

describe('the history tab showing a stored version on the map', () => {
  const historyRoute: Route = { screen: 'section', id: 'section-0', query: [['tab', 'history']] };

  beforeEach(() => addressIs('#/section/section-0?tab=history'));

  const shown = (root: ReactTestRenderer) =>
    (root.root.findByType(SectionMap).props as { versions: number[] }).versions;

  it('draws version 1 when asked and takes it off when asked again', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={historyRoute} />));
    expect(shown(root)).toEqual([]);

    await act(async () => {
      button(root, 'connectPage.sections.showOnMap').props.onClick({});
    });
    await settle();
    expect(shown(root)).toEqual([1]);

    await act(async () => {
      button(root, 'connectPage.sections.hideFromMap').props.onClick({});
    });
    await settle();
    expect(shown(root)).toEqual([]);
    await unmount(root);
  });
});

describe("editing a section's ends", () => {
  const route: Route = { screen: 'section', id: 'section-0', query: [] };
  const detail = SCRIPT.results['section.detail'] as { section: { encodedPolyline: string } };
  const line = lngLatOf(pointsOf(detail.section.encodedPolyline));
  const extension = SCRIPT.byActivity?.['section.extensionTrack']?.['section-0'] as {
    activityId: string;
    encodedTrack: string;
  };
  const track = lngLatOf(pointsOf(extension.encodedTrack));

  beforeEach(() => addressIs('#/section/section-0'));

  const editorOf = (root: ReactTestRenderer) =>
    (root.root.findByType(SectionMap).props as { editor: BoundsEditor | null }).editor;

  const open = async (root: ReactTestRenderer) => {
    await act(async () => {
      button(root, 'connectPage.sections.editBounds').props.onClick();
    });
    await settle();
  };

  /** A position a few metres from a vertex, as a pointer lands beside the line it is dragging. */
  const near = (at: [number, number]): [number, number] => [at[0] + 1e-6, at[1] + 1e-6];

  const drag = async (root: ReactTestRenderer, handle: 'start' | 'end', at: [number, number]) => {
    await act(async () => {
      editorOf(root)?.onMove(handle, at as never);
    });
  };

  const save = async (root: ReactTestRenderer) => {
    await act(async () => {
      button(root, 'connectPage.sections.boundsSave').props.onClick();
    });
    await settle();
  };

  it('has the line and its two grips in the map only once Edit bounds is pressed', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    expect(editorOf(root)).toBeNull();
    await open(root);
    const editor = editorOf(root);
    expect(editor?.view.span).toEqual({ start: 0, end: line.length - 1 });
    expect(editor?.view.path).toEqual(line);
    await unmount(root);
  });

  const textOf = (root: ReactTestRenderer, id: string) =>
    root.root
      .findAll((node) => node.props.id === id)[0]
      ?.findAll((node) => typeof node.children[0] === 'string')
      .flatMap((node) => node.children)
      .join('');

  it("shows the engine's measure of the ends being dragged, with no approximation sign", async () => {
    const preview = { distanceMeters: 1234, avgGradePercent: 3.2, lapsRemeasured: 4 };
    const { phone } = demoPhone({ 'section.boundsPreview': preview });
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    expect(phone.callsOf('section.boundsPreview')).toEqual([]);
    expect(textOf(root, 'bounds-laps')).toBeUndefined();

    await drag(root, 'end', near(line[20] as [number, number]));
    await settle();

    expect(phone.callsOf('section.boundsPreview').map((call) => call.params)).toEqual([
      {
        id: 'section-0',
        edit: 'trim',
        activityId: null,
        startIndex: 0,
        endIndex: 20,
        version: null,
      },
    ]);
    expect(textOf(root, 'bounds-length')).toBe(km(1234));
    expect(textOf(root, 'bounds-grade')).toBe('3.2 %');
    expect(textOf(root, 'bounds-laps')).toContain('connectPage.sections.boundsLaps');
    await unmount(root);
  });

  it('shows no figure for ends the engine has not measured yet rather than an estimate', async () => {
    const { phone } = demoPhone({ 'section.boundsPreview': new Promise(() => undefined) });
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await drag(root, 'end', near(line[20] as [number, number]));
    expect(textOf(root, 'bounds-length')).toBe('–');
    expect(textOf(root, 'bounds-grade')).toBe('–');
    await unmount(root);
  });

  it('asks for no preview of ends too close together to save', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await drag(root, 'end', line[0] as [number, number]);
    await settle();
    expect(phone.callsOf('section.boundsPreview')[0]?.params).toMatchObject({ endIndex: 4 });
    await unmount(root);
  });

  it('sends one trim with the snapped index when the end grip is dragged and saved, and undoes it', async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);

    await drag(root, 'end', near(line[20] as [number, number]));
    expect(editorOf(root)?.view.span).toEqual({ start: 0, end: 20 });
    expect(writes).toEqual([]);

    await save(root);
    expect(writes).toEqual([
      [
        'section.editBounds',
        {
          id: 'section-0',
          edit: 'trim',
          activityId: null,
          startIndex: 0,
          endIndex: 20,
          version: null,
        },
      ],
    ]);
    expect(editorOf(root)).toBeNull();
    expect(toasts(root)).toHaveLength(1);

    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    expect(writes[1]).toEqual([
      'section.editBounds',
      {
        id: 'section-0',
        edit: 'revert',
        activityId: null,
        startIndex: null,
        endIndex: null,
        version: 2,
      },
    ]);
    await unmount(root);
  });

  it('keeps the grips five points apart however far one is dragged', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await drag(root, 'end', line[0] as [number, number]);
    expect(editorOf(root)?.view.span).toEqual({ start: 0, end: 4 });
    await drag(root, 'start', line[line.length - 1] as [number, number]);
    expect(editorOf(root)?.view.span).toEqual({ start: 0, end: 4 });
    await unmount(root);
  });

  it('steps a grip one vertex with the arrow keys', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await act(async () => {
      editorOf(root)?.onStep('end', -1);
    });
    await act(async () => {
      editorOf(root)?.onStep('start', 1);
    });
    expect(editorOf(root)?.view.span).toEqual({ start: 1, end: line.length - 2 });
    await unmount(root);
  });

  it('offers no save while the ends are where the line has them', async () => {
    const { phone } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    expect(button(root, 'connectPage.sections.boundsSave').props.disabled).toBe(true);
    await drag(root, 'end', near(line[10] as [number, number]));
    expect(button(root, 'connectPage.sections.boundsSave').props.disabled).toBe(false);
    await unmount(root);
  });

  it('closes on Escape and on Cancel and sends nothing', async () => {
    const keys: ((event: { key: string }) => void)[] = [];
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    (globalThis as { window: { addEventListener: unknown } }).window.addEventListener = (
      type: string,
      listener: (event: { key: string }) => void
    ) => {
      if (type === 'keydown') keys.push(listener);
    };
    await open(root);
    expect(keys.length).toBeGreaterThan(0);
    await act(async () => {
      for (const listener of keys) listener({ key: 'Escape' });
    });
    expect(editorOf(root)).toBeNull();

    await open(root);
    await act(async () => {
      button(root, 'connectPage.sections.cancel').props.onClick();
    });
    expect(editorOf(root)).toBeNull();
    expect(writes).toEqual([]);
    await unmount(root);
  });

  it("runs the grips along the reference ride's track beyond the ends and saves an expand over its indices", async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await act(async () => {
      button(root, 'connectPage.sections.boundsBeyond').props.onClick();
    });
    const editor = editorOf(root);
    expect(editor?.view.path).toEqual(track);
    expect(editor?.view.span).toEqual({ start: 10, end: 39 });
    expect(editor?.view.window.start).toBeLessThan(10);

    await drag(root, 'start', near(track[3] as [number, number]));
    expect(editorOf(root)?.view.span).toEqual({ start: 3, end: 39 });
    await save(root);
    expect(writes).toEqual([
      [
        'section.editBounds',
        {
          id: 'section-0',
          edit: 'expand',
          activityId: extension.activityId,
          startIndex: 3,
          endIndex: 39,
          version: null,
        },
      ],
    ]);
    await unmount(root);
  });

  it('says the ends can only move along the line when the ride is not stored', async () => {
    const { phone } = demoPhone();
    const failing = fakePhone((method, params) => {
      if (method === 'section.extensionTrack')
        throw new Error('Section has no representative activity');
      const answer = answerAsk(SCRIPT, method, params as Record<string, unknown>);
      if (answer.error !== undefined) throw new Error(answer.error);
      return answer.result;
    });
    void phone;
    const root = await mount(failing.wrap(<SectionDetailPage route={route} />));
    await open(root);
    const notes = root.root.findAll(
      (node) => node.type === 'p' && node.children.includes('connectPage.sections.boundsNoTrack')
    );
    expect(notes).toHaveLength(1);
    await unmount(root);
  });

  it('puts the original line back with Reset bounds and offers an undo', async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={route} />));
    await open(root);
    await act(async () => {
      button(root, 'connectPage.sections.boundsReset').props.onClick();
    });
    await settle();
    expect(writes).toEqual([
      [
        'section.editBounds',
        {
          id: 'section-0',
          edit: 'reset',
          activityId: null,
          startIndex: null,
          endIndex: null,
          version: null,
        },
      ],
    ]);
    expect(editorOf(root)).toBeNull();
    expect(toasts(root)).toHaveLength(1);
    await unmount(root);
  });
});

describe("setting a section's reference from the laps table", () => {
  const lapsAt: Route = { screen: 'section', id: 'section-0', query: [['tab', 'laps']] };

  beforeEach(() => addressIs('#/section/section-0?tab=laps'));

  it('sets the reference to the ride of the row the menu was opened on, and undoes it', async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={lapsAt} />));
    const row = rows(root)[1];
    const lap = String(row.props['data-row']);
    const performance = SCRIPT.byActivity?.['section.performance']?.['section-0'] as {
      lapRecords: { activityId: string; laps: { id: string }[] }[];
    };
    const owner = performance.lapRecords.find((record) =>
      record.laps.some((entry) => entry.id === lap)
    );

    const wrapper = root.root.findAll((node) => node.props.onContextMenuCapture !== undefined)[0];
    await act(async () => {
      wrapper.props.onContextMenuCapture({
        target: { closest: () => ({ getAttribute: () => lap }) },
      });
    });
    const menu = root.root.findByType(ContextMenu).props as {
      items: { id: string; onSelect: () => void }[];
    };
    await act(async () => {
      menu.items.find((item) => item.id === 'setReference')?.onSelect();
    });
    await settle();
    expect(writes[0]).toEqual([
      'section.editBounds',
      {
        id: 'section-0',
        edit: 'setReference',
        activityId: owner?.activityId,
        startIndex: null,
        endIndex: null,
        version: null,
      },
    ]);
    expect(toasts(root)).toHaveLength(1);
    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    expect(writes[1]?.[1]).toMatchObject({ edit: 'revert', version: 2 });
    await unmount(root);
  });

  it('hands the reference back to detection from the same menu', async () => {
    const { phone, writes } = demoPhone();
    const root = await mount(phone.wrap(<SectionDetailPage route={lapsAt} />));
    const menu = root.root.findByType(ContextMenu).props as {
      items: { id: string; onSelect: () => void; disabled?: boolean }[];
    };
    expect(menu.items.find((item) => item.id === 'setReference')?.disabled).toBe(true);
    await act(async () => {
      menu.items.find((item) => item.id === 'resetReference')?.onSelect();
    });
    await settle();
    expect(writes[0]?.[1]).toMatchObject({ edit: 'resetReference', id: 'section-0' });
    await unmount(root);
  });
});

describe('merging a section with a neighbour', () => {
  const mergeRoute: Route = {
    screen: 'section',
    id: 'section-0',
    query: [
      ['tab', 'merge'],
      ['candidate', 'section-1'],
    ],
  };

  beforeEach(() => {
    addressIs('#/section/section-0?tab=merge&candidate=section-1');
    (globalThis as { location?: unknown }).location = { hash: '' };
  });
  afterEach(() => delete (globalThis as { location?: unknown }).location);

  it('names the rides the merge leaves out before it is sent, then offers an undo that restores the merged section', async () => {
    const dropped = [{ activityId: 'a-7', name: 'Dawn loop', startDate: 1_700_000_000 }];
    const { phone, writes } = demoPhone({
      'section.mergePreview': { dropped, lapsRemeasured: 5 },
    });
    const root = await mount(phone.wrap(<SectionDetailPage route={mergeRoute} />));
    await act(async () => {
      button(root, 'connectPage.sections.merge').props.onClick({
        stopPropagation: () => undefined,
      });
    });
    await settle();
    expect(writes).toEqual([]);
    const dialog = root.root.findAll((node) => node.props.role === 'dialog')[0];
    const text = JSON.stringify(
      dialog.findAll((node) => typeof node.children[0] === 'string').map((n) => n.children)
    );
    expect(text).toContain('Dawn loop');
    expect(text).toContain('connectPage.sections.mergeKept');
    expect(text).toContain('connectPage.sections.mergeLaps');

    await act(async () => {
      const confirm = dialog.findAll(
        (node) =>
          node.type === 'button' &&
          node.children.some((child) => child === 'connectPage.sections.merge')
      )[0];
      confirm?.props.onClick();
    });
    await settle();
    expect(writes).toEqual([
      ['section.merge', { primaryId: 'section-0', secondaryId: 'section-1' }],
    ]);
    expect(toasts(root)).toHaveLength(1);

    await act(async () => {
      button(root, 'connectPage.sections.undo').props.onClick({});
    });
    await settle();
    expect(writes[1]).toEqual(['section.restore', { id: 'section-1' }]);
    await unmount(root);
  });
});

describe('the over-time chart', () => {
  const DAY_SECONDS = 86_400;
  beforeEach(() => addressIs('#/section/section-0'));

  it("draws the engine's speed trend band for the direction shown, with no fit of its own", async () => {
    const base = SCRIPT.results['section.performance'] as never as {
      chartData: { points: { activityDate: number }[] };
    };
    const first = Math.min(...base.chartData.points.map((point) => point.activityDate));
    const speedBand = [0, 1, 2, 3, 4].map((day) => ({
      time: first + day * DAY_SECONDS,
      value: 5 + day * 0.1,
      lower: 4.5 + day * 0.1,
      upper: 5.5 + day * 0.1,
    }));
    const { phone } = demoPhone({
      'section.performance': {
        ...base,
        trendCurves: {
          forwardSpeed: speedBand,
          forwardTime: null,
          reverseSpeed: null,
          reverseTime: null,
        },
      },
    });
    const root = await mount(
      phone.wrap(<SectionDetailPage route={{ screen: 'section', id: 'section-0', query: [] }} />)
    );

    const curves = root.root.findAll(
      (node) => node.type === 'path' && node.props.className === 'curve-line'
    );
    expect(curves).toHaveLength(1);
    expect(String(curves[0]!.props.d).match(/[ML]/g)).toHaveLength(speedBand.length);
    expect(
      root.root.findAll((node) => node.type === 'line' && node.props.className === 'trend-line')
    ).toHaveLength(0);
    root.unmount();
  });
});

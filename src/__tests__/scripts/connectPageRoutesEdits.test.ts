/**
 * Scenario: the section, route and activity panes send the engine's edits, and
 * the edits that can be reversed offer the undo a toast shows.
 *
 * Expected behaviour: each edit is sent as the one write method it names. A
 * refusal returns the engine's text. An edit that changes something offers a
 * notice and an undo that sends the edit which puts back what it changed; an
 * edit nothing reverts offers neither.
 */

import type { Optimistic } from '../../../web/connect/query';
import methods from '../../../web/connect/methods.json';
import {
  applyEdit,
  callOf,
  invalidatesOf,
  undoOf,
  type Edit,
} from '../../../web/connect/routesEdits';

const EDITS: [Edit, string, object][] = [
  [
    { kind: 'renameSection', id: 's1', name: 'Hill', was: 'Col' },
    'section.rename',
    { id: 's1', name: 'Hill' },
  ],
  [{ kind: 'setLift', id: 's1', isLift: true }, 'section.setLift', { id: 's1', isLift: true }],
  [{ kind: 'accept', id: 's1' }, 'section.accept', { id: 's1' }],
  [{ kind: 'setEnabled', id: 's1', enabled: true }, 'section.enable', { id: 's1' }],
  [{ kind: 'setEnabled', id: 's1', enabled: false }, 'section.disable', { id: 's1' }],
  [
    { kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: true },
    'section.excludeActivity',
    { id: 's1', activityId: 'a1' },
  ],
  [
    { kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: false },
    'section.includeActivity',
    { id: 's1', activityId: 'a1' },
  ],
  [
    { kind: 'renameRoute', id: 'r1', name: 'Loop', was: 'Lap' },
    'route.rename',
    { id: 'r1', name: 'Loop' },
  ],
  [
    { kind: 'routePass', id: 'r1', activityId: 'a1', excluded: true },
    'route.excludeActivity',
    { id: 'r1', activityId: 'a1' },
  ],
  [
    { kind: 'routePass', id: 'r1', activityId: 'a1', excluded: false },
    'route.includeActivity',
    { id: 'r1', activityId: 'a1' },
  ],
  [
    { kind: 'heatmap', activityId: 'a1', hidden: true },
    'heatmap.setHidden',
    { activityId: 'a1', hidden: true },
  ],
];

describe('applyEdit', () => {
  it.each(EDITS)('sends %j as %s', async (edit, method, params) => {
    expect(callOf(edit)).toEqual({ method, params });
    const sent: unknown[] = [];
    const outcome = await applyEdit(async (m, p) => {
      sent.push([m, p]);
      return { ok: true };
    }, edit);
    expect(outcome).toEqual({ ok: true });
    expect(sent).toEqual([[method, params]]);
  });

  it('returns the engine refusal text', async () => {
    const outcome = await applyEdit(
      async () => {
        throw new Error('that name is already taken');
      },
      { kind: 'renameSection', id: 's1', name: 'Hill', was: 'Col' }
    );
    expect(outcome).toEqual({ ok: false, refusal: 'that name is already taken' });
  });

  it('treats ok false as a refusal with no text', async () => {
    const outcome = await applyEdit(async () => ({ ok: false }), { kind: 'accept', id: 's1' });
    expect(outcome).toEqual({ ok: false, refusal: '' });
  });

  it('passes the notice and an undo that sends the reverse edit', async () => {
    const calls: [string, unknown, unknown][] = [];
    await applyEdit(
      async (method, params, options) => {
        calls.push([method, params, options]);
        return { ok: true };
      },
      { kind: 'heatmap', activityId: 'a1', hidden: true }
    );
    const [method, params, options] = calls[0] as [
      string,
      object,
      { notice: string; undo: () => unknown },
    ];
    expect(method).toBe('heatmap.setHidden');
    expect(params).toEqual({ activityId: 'a1', hidden: true });
    expect(options.notice).toBe('connectPage.undo.hidden');
    expect(options.undo()).toEqual({
      method: 'heatmap.setHidden',
      params: { activityId: 'a1', hidden: false },
    });
  });

  it('names the reads a heatmap edit changes', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'heatmap', activityId: 'a1', hidden: true }
    );
    expect(calls[0][2]).toMatchObject({ invalidates: ['activity.detail'] });
  });

  it('shows a rename at once in the section detail it changes', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'renameSection', id: 's1', name: 'Hill', was: 'Col' }
    );
    const options = calls[0][2] as { optimistic: Optimistic[] };
    expect(options.optimistic).toHaveLength(1);
    const [change] = options.optimistic;
    expect(change.method).toBe('section.detail');
    expect(change.args).toEqual({ id: 's1' });
    const shown = change.update(
      { section: { name: 'Col' }, activityRows: [], excludedActivityIds: [] } as never,
      undefined as never
    ) as { section: { name: string } };
    expect(shown.section.name).toBe('Hill');
  });

  it('shows a rename at once in the route detail it changes', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'renameRoute', id: 'r1', name: 'Loop', was: 'Lap' }
    );
    const options = calls[0][2] as { optimistic: Optimistic[] };
    expect(options.optimistic).toEqual([
      expect.objectContaining({ method: 'route.detail', args: { id: 'r1' } }),
    ]);
    const shown = options.optimistic[0].update(
      { group: { customName: 'Lap' }, excludedActivityIds: [] } as never,
      undefined as never
    ) as { group: { customName: string } };
    expect(shown.group.customName).toBe('Loop');
  });

  it('moves an excluded pass out of the section rows at once', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: true }
    );
    const options = calls[0][2] as { optimistic: Optimistic[] };
    const [change] = options.optimistic;
    expect(change.method).toBe('section.detail');
    const shown = change.update(
      {
        section: { name: 'Col' },
        activityRows: [{ activityId: 'a1' }, { activityId: 'a2' }],
        excludedActivityIds: ['gone'],
      } as never,
      undefined as never
    ) as { activityRows: { activityId: string }[]; excludedActivityIds: string[] };
    expect(shown.activityRows.map((row) => row.activityId)).toEqual(['a2']);
    expect(shown.excludedActivityIds).toEqual(['gone', 'a1']);
  });

  it('takes an included pass off the route excluded list at once', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'routePass', id: 'r1', activityId: 'a1', excluded: false }
    );
    const options = calls[0][2] as { optimistic: Optimistic[] };
    expect(options.optimistic[0].method).toBe('route.detail');
    const shown = options.optimistic[0].update(
      { group: { customName: 'Loop' }, excludedActivityIds: ['a1', 'gone'] } as never,
      undefined as never
    ) as { excludedActivityIds: string[] };
    expect(shown.excludedActivityIds).toEqual(['gone']);
  });

  it('sends no undo for an edit nothing reverts', async () => {
    const calls: unknown[][] = [];
    await applyEdit(
      async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      { kind: 'accept', id: 's1' }
    );
    expect((calls[0][2] as { undo?: unknown }).undo).toBeUndefined();
  });
});

describe('undoOf', () => {
  it.each<[Edit, string, Edit]>([
    [
      { kind: 'renameRoute', id: 'r1', name: 'Loop', was: 'Lap' },
      'connectPage.undo.renamed',
      { kind: 'renameRoute', id: 'r1', name: 'Lap', was: 'Loop' },
    ],
    [
      { kind: 'renameSection', id: 's1', name: 'Hill', was: 'Col' },
      'connectPage.undo.renamed',
      { kind: 'renameSection', id: 's1', name: 'Col', was: 'Hill' },
    ],
    [
      { kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: true },
      'connectPage.undo.excluded',
      { kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: false },
    ],
    [
      { kind: 'routePass', id: 'r1', activityId: 'a1', excluded: false },
      'connectPage.undo.included',
      { kind: 'routePass', id: 'r1', activityId: 'a1', excluded: true },
    ],
    [
      { kind: 'heatmap', activityId: 'a1', hidden: false },
      'connectPage.undo.shown',
      { kind: 'heatmap', activityId: 'a1', hidden: true },
    ],
  ])('offers the reverse of %j with its notice', (edit, notice, reverse) => {
    expect(undoOf(edit)).toEqual({ notice, reverse });
  });

  it('offers nothing for an edit nothing reverts', () => {
    expect(undoOf({ kind: 'accept', id: 's1' })).toBeNull();
  });
});

describe('invalidatesOf', () => {
  const named = (edit: Edit): string[] => {
    const matcher = invalidatesOf(edit);
    if (typeof matcher === 'function') throw new Error('an edit names its reads, not a test');
    return [...matcher];
  };
  const known = new Set((methods as { methods: { name: string }[] }).methods.map((m) => m.name));

  it('asks again the route reads for a route rename and none of another screen', () => {
    const reads = named({ kind: 'renameRoute', id: 'r1', name: 'Loop', was: 'Lap' });
    expect(reads).toEqual(expect.arrayContaining(['routes.screen', 'route.detail']));
    expect(reads).not.toContain('fitness.screen');
    expect(reads).not.toContain('section.detail');
    expect(reads).not.toContain('strength.workouts');
  });

  it('asks again the section reads for a section edit and not the route detail', () => {
    const reads = named({ kind: 'sectionPass', id: 's1', activityId: 'a1', excluded: true });
    expect(reads).toEqual(expect.arrayContaining(['routes.screen', 'section.detail']));
    expect(reads).not.toContain('route.detail');
    expect(reads).not.toContain('fitness.screen');
  });

  it.each(EDITS.map(([edit]) => [edit.kind, edit] as const))(
    'names only reads the engine serves for %s',
    (_kind, edit) => {
      const reads = named(edit);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(known.has(read)).toBe(true);
    }
  );
});

/**
 * Scenario: opening one activity reads its stored record. The store is keyed by
 * activity id, so the read is a primary-key lookup.
 *
 * Expected behaviour: the engine is asked for the one activity and never for a
 * date window it would then have to parse. The window read is what a
 * 490-activity library pays on every mount and after every sync event, and it
 * is JSON work on the JS thread.
 */

import { readActivityRecord } from '@/features/activity/lib/engineActivityRecord';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function fakeEngine(records: Record<string, object>) {
  const stored = Object.fromEntries(
    Object.entries(records).map(([id, record]) => [id, { id, ...record }])
  );
  return {
    idReads: [] as string[],
    windowReads: 0,
    getActivityRecord(activityId: string) {
      this.idReads.push(activityId);
      return stored[activityId] ?? null;
    },
    getActivityBodies() {
      this.windowReads += 1;
      return Object.values(stored);
    },
  };
}

function withEngine(engine: unknown) {
  mockGetEngine.mockReturnValue(engine as ReturnType<typeof getEngine>);
}

describe('readActivityRecord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the one activity by its id', () => {
    const engine = fakeEngine({ a: { name: 'Morning ride' }, b: { name: 'Evening ride' } });
    withEngine(engine);

    expect(readActivityRecord('b')).toEqual({ id: 'b', name: 'Evening ride' });
    expect(engine.idReads).toEqual(['b']);
  });

  it('never reads a window', () => {
    const engine = fakeEngine({ a: { name: 'Morning ride' } });
    withEngine(engine);

    readActivityRecord('a');

    expect(engine.windowReads).toBe(0);
  });

  it('scans nothing for an activity that is not stored', () => {
    const engine = fakeEngine({ a: { name: 'Morning ride' } });
    withEngine(engine);

    expect(readActivityRecord('missing')).toBeNull();
    expect(engine.windowReads).toBe(0);
  });

  it('asks nothing at all for an empty id', () => {
    const engine = fakeEngine({ a: { name: 'Morning ride' } });
    withEngine(engine);

    expect(readActivityRecord('')).toBeNull();
    expect(engine.idReads).toEqual([]);
    expect(engine.windowReads).toBe(0);
  });

  it('reads null when the engine holds nothing it can type', () => {
    withEngine({ getActivityRecord: () => undefined });

    expect(readActivityRecord('a')).toBeNull();
  });

  it('reads null when the engine is not up', () => {
    withEngine(null);

    expect(readActivityRecord('a')).toBeNull();
  });

  it('reads null when the engine predates the primary-key read', () => {
    withEngine({ getActivityBodies: () => [] });

    expect(readActivityRecord('a')).toBeNull();
  });
});

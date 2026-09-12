/**
 * Scenario: the best-efforts screen labels at most fourteen rows per sport with
 * the name and date of the activity each best was set on.
 *
 * Expected behaviour: it reads those activities by id. The window read it used
 * to take returns every body in ten years and parses all of them to find
 * fourteen, which scales with the library for a screen whose toggle has a tap's
 * budget.
 */

import { activityLabels } from '@/features/activity/lib/activityLabels';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function fakeEngine(bodies: Record<string, Record<string, unknown>>) {
  const engine = {
    idReads: [] as string[],
    windowReads: 0,
    getActivityBody(activityId: string) {
      engine.idReads.push(activityId);
      const body = bodies[activityId];
      return body ? JSON.stringify({ id: activityId, ...body }) : null;
    },
    getActivityBodies() {
      engine.windowReads += 1;
      return Object.entries(bodies).map(([id, body]) => JSON.stringify({ id, ...body }));
    },
  };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  return engine;
}

const LIBRARY = {
  a1: { name: 'Alpine loop', start_date_local: '2026-03-01T08:00:00' },
  a2: { name: 'Hill repeats', start_date_local: '2026-04-02T18:30:00' },
  a3: { name: 'Recovery spin', start_date_local: '2026-05-03T07:15:00' },
};

describe('activityLabels', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads only the ids it was asked for', () => {
    const engine = fakeEngine(LIBRARY);

    const labels = activityLabels(['a2']);

    expect(labels.get('a2')?.name).toBe('Hill repeats');
    expect(engine.idReads).toEqual(['a2']);
    expect(engine.windowReads).toBe(0);
  });

  it('never reads a window, however many ids it is given', () => {
    const engine = fakeEngine(LIBRARY);

    activityLabels(['a1', 'a2', 'a3']);

    expect(engine.windowReads).toBe(0);
    expect(engine.idReads).toEqual(['a1', 'a2', 'a3']);
  });

  it('carries the local day of each activity', () => {
    fakeEngine(LIBRARY);

    expect(activityLabels(['a1']).get('a1')?.date).toBe('2026-03-01');
  });

  it('leaves out an id with no stored body, so the row reads as not cached', () => {
    fakeEngine(LIBRARY);

    const labels = activityLabels(['a1', 'gone']);

    expect(labels.has('gone')).toBe(false);
    expect(labels.has('a1')).toBe(true);
  });

  it('reads an id once when it is the best for two distances', () => {
    const engine = fakeEngine(LIBRARY);

    activityLabels(['a1', 'a1', 'a2']);

    expect(engine.idReads).toEqual(['a1', 'a2']);
  });

  it('dates an activity with no start date as empty rather than Invalid Date', () => {
    fakeEngine({ a1: { name: 'No date' } });

    expect(activityLabels(['a1'])).toEqual(new Map([['a1', { name: 'No date', date: '' }]]));
  });

  it('asks the engine nothing for no ids', () => {
    const engine = fakeEngine(LIBRARY);

    expect(activityLabels([]).size).toBe(0);
    expect(engine.idReads).toEqual([]);
  });
});

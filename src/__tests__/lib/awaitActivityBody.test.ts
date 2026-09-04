/**
 * Scenario: a push wakes the background task, which needs the activity's name
 * and type before it can write a notification. The body is fetched by Rust on
 * a thread of its own.
 *
 * Expected behaviour: the task asks once and then waits for the engine to say
 * the body landed. Between the request and that announcement it makes no
 * engine call at all, which matters because the read it used to run on a timer
 * scans and parses every body in a thirty-day window.
 */

import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';

type Listener = (payload?: { kind?: string; activityId?: string }) => void;

function fakeEngine(stored: Record<string, string> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const reads: number[] = [];
  const engine = {
    bodies: { ...stored },
    detailRequests: [] as string[],
    getActivityBodies(oldest: number, newest: number) {
      reads.push(newest - oldest);
      return Object.values(engine.bodies);
    },
    syncActivityDetail(activityId: string) {
      engine.detailRequests.push(activityId);
      return true;
    },
    subscribe(event: string, callback: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      listeners.set(event, set);
      set.add(callback);
      return () => set.delete(callback);
    },
    /** Stand in for Rust: store the body, then announce it. */
    land(activityId: string, body: Record<string, unknown>) {
      engine.bodies[activityId] = JSON.stringify({ id: activityId, ...body });
      listeners.get('bodyStored')?.forEach((cb) => cb({ kind: 'activity_detail', activityId }));
    },
    announceOnly(activityId: string) {
      listeners.get('bodyStored')?.forEach((cb) => cb({ kind: 'activity_detail', activityId }));
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    reads: () => reads.length,
  };
  return engine;
}

describe('awaiting an activity body', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns a body that is already stored without asking for it', async () => {
    const engine = fakeEngine({ a1: JSON.stringify({ id: 'a1', name: 'Morning ride' }) });

    const body = await awaitActivityBody(engine, 'a1');

    expect(body?.name).toBe('Morning ride');
    expect(engine.detailRequests).toEqual([]);
  });

  it('asks once and reads nothing until the engine announces the landing', async () => {
    const engine = fakeEngine();
    const pending = awaitActivityBody(engine, 'a1');

    expect(engine.detailRequests).toEqual(['a1']);
    const readsAfterRequest = engine.reads();

    jest.advanceTimersByTime(5_000);
    expect(engine.reads()).toBe(readsAfterRequest);

    engine.land('a1', { name: 'Evening swim' });
    expect(await pending).toMatchObject({ name: 'Evening swim' });
  });

  it('ignores a body that landed for another activity', async () => {
    const engine = fakeEngine();
    const pending = awaitActivityBody(engine, 'a1');

    engine.land('a2', { name: 'Someone else' });
    jest.advanceTimersByTime(1_000);
    engine.land('a1', { name: 'Ours' });

    expect(await pending).toMatchObject({ name: 'Ours' });
  });

  it('gives up at the deadline rather than waiting for a body that never comes', async () => {
    const engine = fakeEngine();
    const pending = awaitActivityBody(engine, 'a1', 15_000);

    jest.advanceTimersByTime(15_000);

    expect(await pending).toBeNull();
    expect(engine.listenerCount('bodyStored')).toBe(0);
  });

  it('unsubscribes once the body has landed', async () => {
    const engine = fakeEngine();
    const pending = awaitActivityBody(engine, 'a1');
    engine.land('a1', { name: 'Ride' });
    await pending;

    expect(engine.listenerCount('bodyStored')).toBe(0);
  });

  it('waits on for an announcement whose body it cannot find', async () => {
    const engine = fakeEngine();
    const pending = awaitActivityBody(engine, 'a1', 15_000);

    engine.announceOnly('a1');
    jest.advanceTimersByTime(15_000);

    expect(await pending).toBeNull();
  });
});

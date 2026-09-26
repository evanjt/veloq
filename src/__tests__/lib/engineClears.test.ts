/**
 * The waiters around the two background wipes that need no re-open after them.
 * The third, the whole-database one, waits inside `EngineClient.clear`.
 *
 * The wipes are Promises the engine answers with, so what these hold is the
 * session's ceiling over them: a wipe past its budget is reported as still
 * running rather than as stuck, and the engine's own failure comes through
 * with its message.
 */

import { runCatalogueClear, runDerivedClear } from '@/shared/native/engineClears';

jest.useFakeTimers();

afterEach(() => {
  jest.clearAllTimers();
});

/** A wipe that never answers, which is what a caller's ceiling is for. */
const neverSettles = <T>() => new Promise<T>(() => {});

describe('runCatalogueClear', () => {
  it('returns once the engine reports it complete', async () => {
    const engine = { runClearRoutesAndSections: jest.fn(() => Promise.resolve()) };

    await expect(runCatalogueClear(engine)).resolves.toEqual({ state: 'complete' });
    expect(engine.runClearRoutesAndSections).toHaveBeenCalledTimes(1);
  });

  it('stops watching at the cap and says the wipe is still running', async () => {
    const engine = { runClearRoutesAndSections: jest.fn(neverSettles<void>) };

    const outcome = runCatalogueClear(engine, 120);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(outcome).resolves.toEqual({ state: 'stillRunning' });
  });

  it('lets the engine error through, message intact', async () => {
    const engine = {
      runClearRoutesAndSections: jest.fn(() =>
        Promise.reject(new Error('Clear thread died without a result'))
      ),
    };

    await expect(runCatalogueClear(engine)).rejects.toThrow('Clear thread died without a result');
  });
});

describe('runDerivedClear', () => {
  const cleared = { sectionsRemoved: 4, activitiesRemoved: 90, activitiesKept: 3 };

  it('hands back what the wipe removed', async () => {
    const engine = { runClearDerived: jest.fn(() => Promise.resolve(cleared)) };

    await expect(runDerivedClear(engine)).resolves.toEqual({
      state: 'complete',
      removed: cleared,
    });
    expect(engine.runClearDerived).toHaveBeenCalledTimes(1);
  });

  it('stops watching at the cap and says the wipe is still running', async () => {
    const engine = { runClearDerived: jest.fn(neverSettles<typeof cleared>) };

    const outcome = runDerivedClear(engine, 120);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(outcome).resolves.toMatchObject({ state: 'stillRunning' });
  });

  it('hands a wipe past the cap back to the caller, to follow once it lands', async () => {
    let land: (removed: typeof cleared) => void = () => {};
    const engine = {
      runClearDerived: jest.fn(
        () =>
          new Promise<typeof cleared>((resolve) => {
            land = resolve;
          })
      ),
    };

    const watching = runDerivedClear(engine, 120);
    await jest.advanceTimersByTimeAsync(2_000);
    const outcome = await watching;
    if (outcome.state !== 'stillRunning') throw new Error('expected the wipe to outlive the cap');

    land(cleared);
    await expect(outcome.landing).resolves.toEqual(cleared);
    expect(engine.runClearDerived).toHaveBeenCalledTimes(1);
  });

  it('lets the engine error through, message intact', async () => {
    const engine = {
      runClearDerived: jest.fn(() =>
        Promise.reject(new Error('Clear thread died without a result'))
      ),
    };

    await expect(runDerivedClear(engine)).rejects.toThrow('Clear thread died without a result');
  });
});

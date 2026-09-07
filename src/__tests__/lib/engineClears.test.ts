/**
 * The waiters around the two background wipes that need no re-open after them.
 * The third, the whole-database one, waits inside `EngineClient.clear`.
 */

import { runCatalogueClear, runDerivedClear } from '@/shared/native/engineClears';

describe('runCatalogueClear', () => {
  it('returns once the engine reports it complete', async () => {
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => 'complete'),
    };

    await expect(runCatalogueClear(engine)).resolves.toBeUndefined();
    expect(engine.startClearRoutesAndSections).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while the wipe is still running', async () => {
    const states = ['running', 'running', 'complete'];
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => states.shift() as string),
    };

    await runCatalogueClear(engine);
    expect(engine.pollClearRoutesAndSections).toHaveBeenCalledTimes(3);
  });

  it('gives up rather than polling forever', async () => {
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => 'running'),
    };

    await expect(runCatalogueClear(engine, 120)).rejects.toThrow('did not finish in time');
  });

  it('surfaces a wipe that stopped without finishing', async () => {
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => 'idle'),
    };

    await expect(runCatalogueClear(engine)).rejects.toThrow('stopped without finishing');
  });

  it('lets the engine error through, message intact', async () => {
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => {
        throw new Error('Clear thread died without a result');
      }),
    };

    await expect(runCatalogueClear(engine)).rejects.toThrow('Clear thread died without a result');
  });
});

describe('runDerivedClear', () => {
  const cleared = { sectionsRemoved: 4, activitiesRemoved: 90, activitiesKept: 3 };

  it('hands back what the wipe removed', async () => {
    const engine = {
      startClearDerived: jest.fn(),
      pollClearDerived: jest.fn(() => ({ state: 'complete', ...cleared })),
    };

    await expect(runDerivedClear(engine)).resolves.toEqual(cleared);
    expect(engine.startClearDerived).toHaveBeenCalledTimes(1);
  });

  /** The counts are only meaningful once it completes, so a running poll is not read. */
  it('keeps polling while the wipe is still running', async () => {
    const polls = [
      { state: 'running', sectionsRemoved: 0, activitiesRemoved: 0, activitiesKept: 0 },
      { state: 'complete', ...cleared },
    ];
    const engine = {
      startClearDerived: jest.fn(),
      pollClearDerived: jest.fn(() => polls.shift()!),
    };

    await expect(runDerivedClear(engine)).resolves.toEqual(cleared);
    expect(engine.pollClearDerived).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than polling forever', async () => {
    const engine = {
      startClearDerived: jest.fn(),
      pollClearDerived: jest.fn(() => ({
        state: 'running',
        sectionsRemoved: 0,
        activitiesRemoved: 0,
        activitiesKept: 0,
      })),
    };

    await expect(runDerivedClear(engine, 120)).rejects.toThrow(
      'Cache clear did not finish in time'
    );
  });

  it('surfaces a wipe that stopped without finishing', async () => {
    const engine = {
      startClearDerived: jest.fn(),
      pollClearDerived: jest.fn(() => ({
        state: 'idle',
        sectionsRemoved: 0,
        activitiesRemoved: 0,
        activitiesKept: 0,
      })),
    };

    await expect(runDerivedClear(engine)).rejects.toThrow('Cache clear stopped without finishing');
  });

  it('lets the engine error through, message intact', async () => {
    const engine = {
      startClearDerived: jest.fn(),
      pollClearDerived: jest.fn(() => {
        throw new Error('Clear thread died without a result');
      }),
    };

    await expect(runDerivedClear(engine)).rejects.toThrow('Clear thread died without a result');
  });
});

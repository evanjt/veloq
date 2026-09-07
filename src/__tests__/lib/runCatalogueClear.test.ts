/**
 * The waiter around the engine's background catalogue wipe.
 */

import { runCatalogueClear } from '@/features/routes/lib/runCatalogueClear';

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

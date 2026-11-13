/**
 * Scenario: the retired map opens while the engine still owes the ground pairs, which a worker
 * works out on a thread of its own and announces on no engine channel.
 *
 * Expected behaviour: the map is read again once the status says the worker stopped, shows the
 * pairs it stored, and stops following. A worker that never runs is not asked for again on every
 * tick.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { routesStatusIsFollowed } from '@/shared/native/routesStatusPoll';
import { useRetiredMapData } from '@/features/routes/hooks/useRoutesScreenData';
import { routesStatus } from '../__shared__/routesStatusStub';

jest.mock('veloqrs', () => {
  const stub = require('../__shared__/veloqrsStub');
  const engine = () => require('@/shared/native/engine').getEngine();
  return stub.withOverrides({
    ...stub.namespacesOver(engine),
    sections: { getRetiredMapData: () => engine().getRetiredMapData() },
  });
});

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface Library {
  pending: boolean;
  running: boolean;
}

function engine(library: Library) {
  return {
    getRetiredMapData: jest.fn(() => ({
      retired: [],
      current: [],
      pairs: library.pending
        ? []
        : [{ retiredId: 'old-climb', currentId: 'new-climb', link: 'ground', overlap: 0.8 }],
      pairsPending: library.pending,
    })),
    getRoutesStatusData: jest.fn(() => routesStatus({ retiredPairsRunning: library.running })),
    subscribe: jest.fn(() => () => {}),
  };
}

const POLL_INTERVAL_MS = 500;

async function tick(n = 1) {
  await act(() => {
    jest.advanceTimersByTime(n * POLL_INTERVAL_MS);
  });
}

describe('useRetiredMapData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the map again once the worker owing its ground pairs stops', async () => {
    const library = { pending: true, running: true };
    const fake = engine(library);
    mockGetEngine.mockReturnValue(fake as unknown as ReturnType<typeof getEngine>);

    const { result } = await renderHook(() => useRetiredMapData());
    expect(result.current.data?.pairsPending).toBe(true);
    expect(result.current.data?.pairs).toEqual([]);

    await tick(3);
    expect(fake.getRetiredMapData).toHaveBeenCalledTimes(1);

    library.running = false;
    library.pending = false;
    await tick();

    expect(fake.getRetiredMapData).toHaveBeenCalledTimes(2);
    expect(result.current.data?.pairsPending).toBe(false);
    expect(result.current.data?.pairs.map((p) => p.currentId)).toEqual(['new-climb']);
    expect(routesStatusIsFollowed()).toBe(false);
  });

  vaultIt(
    'reads once more for a worker that stopped before the follow began, then waits',
    async () => {
      const library = { pending: true, running: false };
      const fake = engine(library);
      mockGetEngine.mockReturnValue(fake as unknown as ReturnType<typeof getEngine>);

      await renderHook(() => useRetiredMapData());
      await tick();
      expect(fake.getRetiredMapData).toHaveBeenCalledTimes(2);

      await tick(20);
      expect(fake.getRetiredMapData).toHaveBeenCalledTimes(2);
    }
  );

  vaultIt('follows nothing when no ground pair is owed', async () => {
    const fake = engine({ pending: false, running: false });
    mockGetEngine.mockReturnValue(fake as unknown as ReturnType<typeof getEngine>);

    await renderHook(() => useRetiredMapData());
    await tick(5);

    expect(fake.getRoutesStatusData).not.toHaveBeenCalled();
    expect(routesStatusIsFollowed()).toBe(false);
  });
});

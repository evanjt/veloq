/**
 * Scenario: an athlete who trains with weights has not been online since
 * install, so no FIT has been fetched and no set is cached.
 *
 * Expected behaviour: the engine's own unprocessed queue is enough to show the
 * tab, so there is a surface from which the fetch can be retried.
 */
import { SyncState } from 'veloqrs';
import { renderHook } from '@testing-library/react-native';
import { useStrengthTabState } from '@/features/strength/hooks/useStrengthScreenData';

// The strength namespace answers through the engine handle unless a test sets
// its own answer here, so the handle and the namespace can be told apart.
const mockStrengthAnswer: { hasSets?: boolean; unfetched?: string[] } = {};

jest.mock('veloqrs', () => {
  const stub = require('../__shared__/veloqrsStub');
  const over = stub.namespacesOver(() => require('@/shared/native/engine').getEngine());
  return stub.withOverrides({
    ...over,
    strength: {
      ...over.strength,
      hasStrengthData: () =>
        mockStrengthAnswer.hasSets ?? (over.strength.hasStrengthData as () => boolean)(),
      getUnprocessedStrengthIds: () =>
        mockStrengthAnswer.unfetched ??
        (over.strength.getUnprocessedStrengthIds as () => string[])(),
    },
  });
});

const mockEngine: Record<string, unknown> = {};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

function engineWith(hasSets: boolean, unfetched: string[]) {
  for (const key of Object.keys(mockEngine)) delete mockEngine[key];
  Object.assign(mockEngine, {
    subscribe: () => () => {},
    getSyncStatus: () => ({ state: SyncState.Idle }),
    hasStrengthData: () => hasSets,
    getUnprocessedStrengthIds: () => unfetched,
  });
}

describe('useStrengthTabState', () => {
  vaultIt('is ready when sets are cached', async () => {
    engineWith(true, []);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('ready');
  });

  it('awaits the download when nothing is cached but the queue is not empty', async () => {
    engineWith(false, ['act-1', 'act-2']);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('awaiting');
  });

  vaultIt('is hidden when the athlete has no strength activities at all', async () => {
    engineWith(false, []);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('hidden');
  });

  it('is hidden when the engine throws rather than propagating', async () => {
    engineWith(false, []);
    mockEngine.hasStrengthData = () => {
      throw new Error('engine is gone');
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('hidden');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[StrengthTab]'), expect.any(Error));
    warn.mockRestore();
  });

  it('reads the sets and the queue through the strength namespace, not the handle', async () => {
    engineWith(false, []);
    delete mockEngine.hasStrengthData;
    delete mockEngine.getUnprocessedStrengthIds;
    mockStrengthAnswer.hasSets = true;
    mockStrengthAnswer.unfetched = [];
    try {
      expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('ready');
    } finally {
      delete mockStrengthAnswer.hasSets;
      delete mockStrengthAnswer.unfetched;
    }
  });

  it('awaits the download from the namespace queue when the handle has no queue method', async () => {
    engineWith(false, []);
    delete mockEngine.getUnprocessedStrengthIds;
    mockStrengthAnswer.hasSets = false;
    mockStrengthAnswer.unfetched = ['act-1'];
    try {
      expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('awaiting');
    } finally {
      delete mockStrengthAnswer.hasSets;
      delete mockStrengthAnswer.unfetched;
    }
  });
});

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

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

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
  it('is ready when sets are cached', async () => {
    engineWith(true, []);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('ready');
  });

  it('awaits the download when nothing is cached but the queue is not empty', async () => {
    engineWith(false, ['act-1', 'act-2']);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('awaiting');
  });

  it('is hidden when the athlete has no strength activities at all', async () => {
    engineWith(false, []);
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('hidden');
  });

  it('is hidden when the engine throws rather than propagating', async () => {
    engineWith(false, []);
    mockEngine.hasStrengthData = () => {
      throw new Error('engine is gone');
    };
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('hidden');
  });

  it('falls back to the cached answer on a binary with no unprocessed queue', async () => {
    engineWith(true, []);
    delete mockEngine.getUnprocessedStrengthIds;
    expect(await (await renderHook(() => useStrengthTabState())).result.current).toBe('ready');
  });
});

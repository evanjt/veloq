/**
 * Scenario: the engine handle is absent when the feed mounts.
 *
 * Expected behaviour: the feed schedules no timer while it waits, and
 * subscribes the moment the handle arrives.
 *
 * Scenario: the feed mounts before the root layout opens the engine, so the
 * read at mount answers nothing, and opening announces nothing on any channel.
 *
 * Expected behaviour: the open reads the card, and a settle reads it when every
 * read during the sync came back empty, rather than leaving the card blank
 * until a pull to refresh.
 */

import { act, renderHook } from '@testing-library/react-native';
import { SyncState } from 'veloqrs';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { getEngine } from '@/shared/native/engine';
import { useStartupData } from '@/features/home/hooks/useStartupData';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [],
  })
);

jest.mock('@/features/insights/lib/insightsParams', () => ({
  buildInsightsParams: () => ({}),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  jest.useRealTimers();
});

it('schedules no timer while the engine is absent', async () => {
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  await renderHook(() => useStartupData(['a1']));
  expect(setIntervalSpy).not.toHaveBeenCalled();
  setIntervalSpy.mockRestore();
});

it('subscribes to the signals once when the engine is present', async () => {
  const subscribe = jest.fn(() => () => {});
  mockGetEngine.mockReturnValue({
    subscribe,
    getSyncStatus: () => ({ state: 0 }),
    getStartupData: () => ({ summaryCard: {}, previewTracks: [] }),
  } as unknown as ReturnType<typeof getEngine>);
  await renderHook(() => useStartupData(['a1']));

  expect(subscribe).toHaveBeenCalledWith('syncSettled', expect.any(Function));
  expect(subscribe).toHaveBeenCalledWith('bodyStored', expect.any(Function));
});

describe('an engine that opens after the feed mounts', () => {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  let open = false;
  let syncState = 0;
  let reads = 0;
  let busy = false;
  let fitness = 42;

  function engine() {
    return {
      subscribe: (event: string, cb: (payload?: unknown) => void) => {
        const forEvent = listeners.get(event) ?? new Set();
        forEvent.add(cb);
        listeners.set(event, forEvent);
        return () => forEvent.delete(cb);
      },
      getSyncStatus: () => (open ? { state: syncState } : null),
      // A handle that is not open answers with nothing, the way the client does.
      getStartupData: () => {
        if (!open) return undefined;
        if (busy) throw new Error('busy');
        reads += 1;
        return { summaryCard: { heroValue: fitness }, previewTracks: [] };
      },
    } as unknown as ReturnType<typeof getEngine>;
  }

  async function settleTimers() {
    await act(() => {
      jest.runOnlyPendingTimers();
    });
  }

  async function announce(event: string, payload?: unknown) {
    await act(() => {
      listeners.get(event)?.forEach((cb) => cb(payload));
    });
    await settleTimers();
  }

  async function openEngine() {
    open = true;
    await act(() => {
      useEngineStatus.getState().markEngineReady();
    });
    await settleTimers();
  }

  beforeEach(() => {
    listeners.clear();
    open = false;
    syncState = 0;
    reads = 0;
    busy = false;
    fitness = 42;
  });

  it('hears the wellness landing once a handle that was absent at mount arrives', async () => {
    const rendered = await renderHook(() => useStartupData(['a1']));
    await settleTimers();
    expect(rendered.result.current.data).toBeNull();

    mockGetEngine.mockReturnValue(engine());
    await openEngine();
    fitness = 57;
    await announce('bodyStored', { kind: 'wellness', activityId: '' });

    expect(rendered.result.current.data?.summaryCardData).toEqual({ heroValue: 57 });
    rendered.unmount();
  });

  it('reads the card when the engine opens, with no announcement after it', async () => {
    mockGetEngine.mockReturnValue(engine());
    const rendered = await renderHook(() => useStartupData(['a1']));
    await settleTimers();
    expect(rendered.result.current.data).toBeNull();

    await openEngine();

    expect(rendered.result.current.data?.summaryCardData).toEqual({ heroValue: 42 });
    rendered.unmount();
  });

  it('reads at the settle when the reads during the sync left the card empty', async () => {
    mockGetEngine.mockReturnValue(engine());
    open = true;
    busy = true;
    syncState = SyncState.Syncing;
    const rendered = await renderHook(() => useStartupData(['a1']));
    await settleTimers();
    expect(rendered.result.current.data).toBeNull();

    busy = false;
    syncState = SyncState.Idle;
    await announce('syncSettled');

    expect(reads).toBe(1);
    expect(rendered.result.current.data?.summaryCardData).toEqual({ heroValue: 42 });
    rendered.unmount();
  });
});

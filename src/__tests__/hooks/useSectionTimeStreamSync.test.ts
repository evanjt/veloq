/**
 * Scenario: a section detail opens on activities whose `time` streams are not
 * stored yet, so it asks Rust for them and waits.
 *
 * Expected behaviour: the wait makes no engine calls at all. Rust announces
 * each stream as it lands, and the hook is ready on the announcement rather
 * than on the next tick of a timer.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSectionTimeStreamSync } from '@/features/routes/hooks/useSectionPerformances';
import { engine, StartOutcome } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();
let mockIsOnline = true;

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => mockIsOnline,
}));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      getActivitiesMissingTimeStreams: jest.fn(() => [] as string[]),
      syncTimeStreams: jest.fn(),
      subscribe: jest.fn((event: string, callback: MockListener) => {
        const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
        forEvent.add(callback);
        mockListeners.set(event, forEvent);
        return () => forEvent.delete(callback);
      }),
    },
  })
);

const missing = engine.getActivitiesMissingTimeStreams as unknown as jest.Mock;
const syncTimeStreams = engine.syncTimeStreams as unknown as jest.Mock;

/** Stands in for the announcement Rust makes off the JS thread. */
function announce(activityIds: string[]) {
  act(() => {
    mockListeners.get('timeStreamsStored')?.forEach((listener) => listener({ activityIds }));
  });
}

/** The real caller memoises its id list, so the hook sees one stable array. */
function renderSync(ids: string[], known?: string[]) {
  return renderHook(() => useSectionTimeStreamSync(ids, known));
}

function startsWith(outcome: StartOutcome) {
  syncTimeStreams.mockReturnValue({ outcome });
}

describe('useSectionTimeStreamSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    missing.mockReturnValue([]);
    startsWith(StartOutcome.Started);
  });

  it('is ready without asking for anything when every stream is stored', async () => {
    const { result } = renderSync(['a1', 'a2']);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(syncTimeStreams).not.toHaveBeenCalled();
    expect(result.current.outstanding).toBe(0);
  });

  it('makes no engine calls between the request and the announcement', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    jest.useFakeTimers();

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});
    expect(syncTimeStreams).toHaveBeenCalledWith(['a1', 'a2']);
    const callsAtRequest = missing.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(missing).toHaveBeenCalledTimes(callsAtRequest);
    expect(result.current.ready).toBe(false);

    announce(['a1', 'a2']);
    await act(async () => {});

    expect(result.current.ready).toBe(true);
    expect(missing).toHaveBeenCalledTimes(callsAtRequest);
    jest.useRealTimers();
  });

  it('stays waiting until every activity it asked for has landed', async () => {
    missing.mockReturnValue(['a1', 'a2']);

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});

    announce(['a1']);
    await act(async () => {});
    expect(result.current.ready).toBe(false);

    announce(['a2']);
    await act(async () => {});
    expect(result.current.ready).toBe(true);
    expect(result.current.outstanding).toBe(0);
  });

  it('renders what landed when a stream never arrives, and counts the one missing', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    jest.useFakeTimers();

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});
    announce(['a1']);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.outstanding).toBe(1);
    jest.useRealTimers();
  });

  it('takes the gap the caller already read rather than re-reading it', async () => {
    const { result } = renderSync(['a1'], ['a1']);
    await act(async () => {});

    expect(missing).not.toHaveBeenCalled();
    expect(syncTimeStreams).toHaveBeenCalledWith(['a1']);

    announce(['a1']);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('leaves no listener behind once the wait is over', async () => {
    missing.mockReturnValue(['a1']);

    const { unmount } = renderSync(['a1']);
    await act(async () => {});
    announce(['a1']);
    await act(async () => {});
    unmount();

    expect(mockListeners.get('timeStreamsStored')?.size ?? 0).toBe(0);
  });
});

/// Scenario: the device is offline when the section opens, so none of the
/// streams it asked for ever lands. The wait ended on its deadline and the
/// records were read from whichever activities had a stream, with nothing to
/// say the set was partial.
///
/// Expected behaviour: the hook says how many are still missing, a refused start
/// is not waited on, and the missing ones are asked for again on reconnect.
describe('streams that do not arrive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    missing.mockReturnValue([]);
    startsWith(StartOutcome.Started);
    mockIsOnline = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports both outstanding when neither is announced before the deadline', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    jest.useFakeTimers();

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(30_001);
    });

    expect(result.current).toMatchObject({ ready: true, error: null, outstanding: 2 });
  });

  it('does not wait on a start Rust refused', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    startsWith(StartOutcome.Held);

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});

    expect(result.current).toMatchObject({ ready: true, error: null, outstanding: 2 });
    expect(mockListeners.get('timeStreamsStored')?.size ?? 0).toBe(0);
  });

  it('treats an engine that is not open yet as nothing fetched', async () => {
    missing.mockReturnValue(['a1']);
    startsWith(StartOutcome.NotReady);

    const { result } = renderSync(['a1']);
    await act(async () => {});

    expect(result.current).toMatchObject({ ready: true, outstanding: 1 });
  });

  it('waits on a fetch of the same streams already running', async () => {
    missing.mockReturnValue(['a1']);
    startsWith(StartOutcome.Busy);

    const { result } = renderSync(['a1']);
    await act(async () => {});
    expect(result.current.ready).toBe(false);

    announce(['a1']);
    await act(async () => {});

    expect(result.current).toMatchObject({ ready: true, outstanding: 0 });
  });

  it('asks again for what is missing when the network comes back', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    startsWith(StartOutcome.Held);
    mockIsOnline = false;

    const { result, rerender } = renderSync(['a1', 'a2']);
    await act(async () => {});
    expect(syncTimeStreams).toHaveBeenCalledTimes(1);

    startsWith(StartOutcome.Started);
    mockIsOnline = true;
    rerender({});
    await act(async () => {});

    expect(syncTimeStreams).toHaveBeenCalledTimes(2);
    expect(result.current.ready).toBe(false);
    announce(['a1', 'a2']);
    await act(async () => {});
    expect(result.current).toMatchObject({ ready: true, outstanding: 0 });
  });

  it('asks for nothing on reconnect once every stream has landed', async () => {
    missing.mockReturnValue(['a1']);
    mockIsOnline = false;

    const { rerender } = renderSync(['a1']);
    await act(async () => {});
    announce(['a1']);
    await act(async () => {});

    mockIsOnline = true;
    rerender({});
    await act(async () => {});

    expect(syncTimeStreams).toHaveBeenCalledTimes(1);
  });

  it('asks again on retry', async () => {
    missing.mockReturnValue(['a1']);
    startsWith(StartOutcome.Held);

    const { result } = renderSync(['a1']);
    await act(async () => {});
    expect(result.current.outstanding).toBe(1);

    act(() => result.current.refetch());
    await act(async () => {});

    expect(syncTimeStreams).toHaveBeenCalledTimes(2);
  });
});

describe('a wait the caller has moved on from', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    missing.mockReturnValue([]);
    startsWith(StartOutcome.Started);
  });

  /// Scenario: switching sections quickly leaves the previous wait running.
  /// Nothing aborted it, so the older one settled against the new section's
  /// half-populated cache and flipped `ready` true early, and it lived on for
  /// the full thirty-second timeout past unmount.
  ///
  /// Expected behaviour: starting a new wait ends the one before it.
  it('does not flip the new wait ready when the old one settles', async () => {
    missing.mockReturnValue(['old']);
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSectionTimeStreamSync(ids),
      { initialProps: { ids: ['old'] } }
    );
    await act(async () => {});
    expect(syncTimeStreams).toHaveBeenCalledWith(['old']);

    missing.mockReturnValue(['new']);
    rerender({ ids: ['new'] });
    await act(async () => {});
    expect(result.current.ready).toBe(false);

    // The stream the first section was waiting on lands late.
    announce(['old']);
    await act(async () => {});

    expect(result.current.ready).toBe(false);
  });

  it('is ready once the stream the current wait asked for lands', async () => {
    missing.mockReturnValue(['old']);
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSectionTimeStreamSync(ids),
      { initialProps: { ids: ['old'] } }
    );
    await act(async () => {});

    missing.mockReturnValue(['new']);
    rerender({ ids: ['new'] });
    await act(async () => {});

    announce(['new']);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  /// A wait that outlives its component keeps a subscription and a thirty
  /// second timer for nothing.
  it('drops its subscription when the component goes away', async () => {
    missing.mockReturnValue(['a1']);
    const { unmount } = renderSync(['a1']);
    await act(async () => {});
    expect(mockListeners.get('timeStreamsStored')?.size).toBe(1);

    unmount();
    await act(async () => {});

    expect(mockListeners.get('timeStreamsStored')?.size ?? 0).toBe(0);
  });
});

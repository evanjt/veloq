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
import { engine } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

describe('useSectionTimeStreamSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    missing.mockReturnValue([]);
  });

  it('is ready without asking for anything when every stream is stored', async () => {
    const { result } = renderSync(['a1', 'a2']);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(syncTimeStreams).not.toHaveBeenCalled();
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
  });

  it('renders what landed when a stream never arrives', async () => {
    missing.mockReturnValue(['a1', 'a2']);
    jest.useFakeTimers();

    const { result } = renderSync(['a1', 'a2']);
    await act(async () => {});
    announce(['a1']);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(result.current.ready).toBe(true);
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

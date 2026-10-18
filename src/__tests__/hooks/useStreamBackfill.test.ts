/**
 * Scenario: the Settings row is mounted at rest and the engine starts a series
 * pass of its own after a sync settles. Expected behaviour: the row follows it
 * from the announced phase and returns to rest on a terminal one.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { StartOutcome } from 'veloqrs';
import { useStreamBackfill } from '@/features/settings/hooks/useStreamBackfill';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockConsentStreamBackfill = jest.fn();
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    ...require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    ),
    streamBackfill: {
      consentStreamBackfill: () => mockConsentStreamBackfill(),
      stopStreamBackfill: () => {},
    },
  })
);

jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncState: () => 'idle',
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const listeners = new Map<string, Set<() => void>>();
let phase = 'idle';

function engine() {
  return {
    getRoutesStatusData: () => ({
      detection: null,
      stream: {
        phase,
        completed: phase === 'fetching' ? 3 : 0,
        total: phase === 'fetching' ? 10 : 0,
        stored: 0,
        estimateRequests: 0,
        estimateBytes: 0,
      },
      streamRemaining: phase === 'fetching' ? null : 245,
      streamRemainingBytes: phase === 'fetching' ? null : 5_145_000,
      cutover: { phase: 'idle', running: false },
    }),
    subscribe: (event: string, callback: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(callback);
      listeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

async function announce(event: string, next: string) {
  phase = next;
  await act(() => {
    listeners.get(event)?.forEach((listener) => listener());
  });
}

describe('useStreamBackfill', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners.clear();
    phase = 'idle';
    mockGetEngine.mockReturnValue(engine());
    mockConsentStreamBackfill.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('follows a pass the engine starts on a mounted row', async () => {
    const { result } = await renderHook(() => useStreamBackfill());
    expect(result.current.isRunning).toBe(false);
    expect(result.current.remaining).toBe(245);

    await announce('streamBackfillPhase', 'fetching');

    expect(result.current.isRunning).toBe(true);
    expect(result.current.total).toBe(10);
  });

  /**
   * Scenario: the automatic start is waiting for the elevation backfill or the
   * detector cutover. Expected behaviour: the phase reads deferred rather than
   * idle, which is what lets the row offer the pass by hand.
   */
  it('reads a deferred pass as deferred, not as idle', async () => {
    const { result } = await renderHook(() => useStreamBackfill());

    await announce('streamBackfillPhase', 'deferred');

    expect(result.current.phase).toBe('deferred');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.remaining).toBe(245);
  });

  it('carries the owed queue size with the count, and withholds both while running', async () => {
    const { result } = await renderHook(() => useStreamBackfill());
    expect(result.current.remainingBytes).toBe(5_145_000);

    await announce('streamBackfillPhase', 'fetching');

    expect(result.current.remaining).toBeNull();
    expect(result.current.remainingBytes).toBeNull();
  });

  it('returns to rest on a terminal phase', async () => {
    const { result } = await renderHook(() => useStreamBackfill());
    await announce('streamBackfillPhase', 'fetching');

    await announce('streamBackfillPhase', 'complete');

    expect(result.current.isRunning).toBe(false);
    expect(result.current.phase).toBe('complete');
    expect(result.current.remaining).toBe(245);
  });

  it('shows a held download when the engine announces awaiting consent', async () => {
    const { result } = await renderHook(() => useStreamBackfill());

    await announce('streamBackfillPhase', 'awaiting_consent');

    expect(result.current.awaitingConsent).toBe(true);
  });

  it('does not react to the elevation pass phase', async () => {
    const { result } = await renderHook(() => useStreamBackfill());
    phase = 'fetching';
    await act(() => {
      listeners.get('backfillPhase')?.forEach((listener) => listener());
    });
    expect(result.current.isRunning).toBe(false);
  });

  describe('a refused start', () => {
    function withConsent(consent: () => StartOutcome) {
      mockConsentStreamBackfill.mockImplementation(consent);
    }

    it.each([
      StartOutcome.Offline,
      StartOutcome.NotConfigured,
      StartOutcome.NotReady,
      StartOutcome.Busy,
    ])('surfaces verdict %s and does not read as a running pass', async (outcome) => {
      withConsent(() => outcome);
      const { result } = await renderHook(() => useStreamBackfill());

      await act(() => result.current.start());

      expect(result.current.refusal).toBe(outcome);
      expect(result.current.isRunning).toBe(false);
    });

    it('records a thrown start as Failed', async () => {
      withConsent(() => {
        throw new Error('ffi');
      });
      const { result } = await renderHook(() => useStreamBackfill());

      await act(() => result.current.start());

      expect(result.current.refusal).toBe(StartOutcome.Failed);
    });

    it('clears the refusal when the next tap starts', async () => {
      let next = StartOutcome.Offline;
      withConsent(() => next);
      const { result } = await renderHook(() => useStreamBackfill());
      await act(() => result.current.start());
      expect(result.current.refusal).toBe(StartOutcome.Offline);

      next = StartOutcome.Started;
      await act(() => result.current.start());

      expect(result.current.refusal).toBeNull();
    });

    it('clears the refusal when a pass begins', async () => {
      withConsent(() => StartOutcome.Busy);
      const { result } = await renderHook(() => useStreamBackfill());
      await act(() => result.current.start());

      await announce('streamBackfillPhase', 'fetching');

      expect(result.current.refusal).toBeNull();
    });
  });
});

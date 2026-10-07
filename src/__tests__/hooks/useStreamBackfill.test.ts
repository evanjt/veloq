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

function announce(event: string, next: string) {
  phase = next;
  act(() => {
    listeners.get(event)?.forEach((listener) => listener());
  });
}

describe('useStreamBackfill', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners.clear();
    phase = 'idle';
    mockGetEngine.mockReturnValue(engine());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('follows a pass the engine starts on a mounted row', () => {
    const { result } = renderHook(() => useStreamBackfill());
    expect(result.current.isRunning).toBe(false);
    expect(result.current.remaining).toBe(245);

    announce('streamBackfillPhase', 'fetching');

    expect(result.current.isRunning).toBe(true);
    expect(result.current.total).toBe(10);
  });

  it('returns to rest on a terminal phase', () => {
    const { result } = renderHook(() => useStreamBackfill());
    announce('streamBackfillPhase', 'fetching');

    announce('streamBackfillPhase', 'complete');

    expect(result.current.isRunning).toBe(false);
    expect(result.current.phase).toBe('complete');
    expect(result.current.remaining).toBe(245);
  });

  it('shows a held download when the engine announces awaiting consent', () => {
    const { result } = renderHook(() => useStreamBackfill());

    announce('streamBackfillPhase', 'awaiting_consent');

    expect(result.current.awaitingConsent).toBe(true);
  });

  it('does not react to the elevation pass phase', () => {
    const { result } = renderHook(() => useStreamBackfill());
    phase = 'fetching';
    act(() => {
      listeners.get('backfillPhase')?.forEach((listener) => listener());
    });
    expect(result.current.isRunning).toBe(false);
  });

  describe('a refused start', () => {
    function withConsent(consent: () => StartOutcome) {
      const base = engine() as unknown as Record<string, unknown>;
      mockGetEngine.mockReturnValue({
        ...base,
        consentStreamBackfill: consent,
      } as unknown as ReturnType<typeof getEngine>);
    }

    it.each([
      StartOutcome.Offline,
      StartOutcome.NotConfigured,
      StartOutcome.NotReady,
      StartOutcome.Busy,
    ])('surfaces verdict %s and does not read as a running pass', (outcome) => {
      withConsent(() => outcome);
      const { result } = renderHook(() => useStreamBackfill());

      act(() => result.current.start());

      expect(result.current.refusal).toBe(outcome);
      expect(result.current.isRunning).toBe(false);
    });

    it('records a thrown start as Failed', () => {
      withConsent(() => {
        throw new Error('ffi');
      });
      const { result } = renderHook(() => useStreamBackfill());

      act(() => result.current.start());

      expect(result.current.refusal).toBe(StartOutcome.Failed);
    });

    it('clears the refusal when the next tap starts', () => {
      let next = StartOutcome.Offline;
      withConsent(() => next);
      const { result } = renderHook(() => useStreamBackfill());
      act(() => result.current.start());
      expect(result.current.refusal).toBe(StartOutcome.Offline);

      next = StartOutcome.Started;
      act(() => result.current.start());

      expect(result.current.refusal).toBeNull();
    });

    it('clears the refusal when a pass begins', () => {
      withConsent(() => StartOutcome.Busy);
      const { result } = renderHook(() => useStreamBackfill());
      act(() => result.current.start());

      announce('streamBackfillPhase', 'fetching');

      expect(result.current.refusal).toBeNull();
    });
  });
});

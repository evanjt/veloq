/**
 * Scenario: the radio is up but nothing reaches intervals.icu. A captive portal,
 * a DNS black hole or a sustained 5xx leaves every sync failing while the app
 * looks merely empty, because the engine's `lastError` had no renderer.
 *
 * Expected behaviour: the hook reports that error and the engine's own time of
 * the last clean sync, and writes nothing itself.
 */

import { renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { SyncState, type SyncStatus } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

let mockStatus: SyncStatus | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(
  state: SyncStatus['state'],
  extra: { lastError?: string; lastSuccessAt?: string } = {}
): SyncStatus {
  return {
    state,
    inFlight: 0,
    completed: 0,
    total: 0,
    stepItemsDone: 0,
    stepItemsTotal: 0,
    ...extra,
  };
}

describe('useSyncHealth', () => {
  const setSetting = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = null;
    mockGetEngine.mockReturnValue({ setSetting } as unknown as ReturnType<typeof getEngine>);
  });

  it('reports nothing for a null status', () => {
    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastError).toBeNull();
    expect(result.current.lastSuccessAt).toBeNull();
  });

  it('reports nothing for a status with no success time', () => {
    mockStatus = status(SyncState.Idle);

    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastSuccessAt).toBeNull();
  });

  it('returns the engine time for a status first seen idle and never seen syncing', () => {
    mockStatus = status(SyncState.Idle, { lastSuccessAt: '2026-08-01T10:00:00.000Z' });

    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastSuccessAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('replaces the time when the next snapshot carries a newer one', () => {
    mockStatus = status(SyncState.Idle, { lastSuccessAt: '2026-08-01T10:00:00.000Z' });
    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status(SyncState.Idle, { lastSuccessAt: '2026-08-02T10:00:00.000Z' });
    rerender(undefined);

    expect(result.current.lastSuccessAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('writes nothing when a sync settles clean, with two instances mounted', () => {
    const a = renderHook(() => useSyncHealth());
    const b = renderHook(() => useSyncHealth());

    mockStatus = status(SyncState.Syncing);
    a.rerender(undefined);
    b.rerender(undefined);
    mockStatus = status(SyncState.Idle, { lastSuccessAt: '2026-08-03T10:00:00.000Z' });
    a.rerender(undefined);
    b.rerender(undefined);

    expect(setSetting).not.toHaveBeenCalled();
    expect(a.result.current.lastSuccessAt).toBe('2026-08-03T10:00:00.000Z');
    expect(b.result.current.lastSuccessAt).toBe('2026-08-03T10:00:00.000Z');
  });

  it('keeps the earlier success time while a failing sync reports its error', () => {
    mockStatus = status(SyncState.Idle, {
      lastError: 'HTTP 503',
      lastSuccessAt: '2026-08-01T10:00:00.000Z',
    });

    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastError).toBe('HTTP 503');
    expect(result.current.lastSuccessAt).toBe('2026-08-01T10:00:00.000Z');
  });
});

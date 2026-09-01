/**
 * Scenario: the radio is up but nothing reaches intervals.icu. A captive portal,
 * a DNS black hole or a sustained 5xx leaves every sync failing while the app
 * looks merely empty, because the engine's `lastError` had no renderer.
 *
 * Expected behaviour: the hook reports that error and the time of the last sync
 * that actually landed, persisted in engine settings so the answer survives the
 * relaunch where the error alone says nothing.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { getEngine } from '@/shared/native/engine';
import { LAST_SUCCESS_KEY, useSyncHealth } from '@/shared/native/useSyncHealth';
import type { SyncStatus } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

let mockStatus: SyncStatus | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

type FakeEngine = {
  settings: Map<string, string>;
  getSetting: jest.Mock;
  setSetting: jest.Mock;
};

function fakeEngine(seed: Record<string, string> = {}): FakeEngine {
  const settings = new Map(Object.entries(seed));
  return {
    settings,
    getSetting: jest.fn((key: string) => settings.get(key)),
    setSetting: jest.fn((key: string, value: string) => {
      settings.set(key, value);
    }),
  };
}

function status(state: SyncStatus['state'], lastError?: string): SyncStatus {
  return { state, inFlight: 0, completed: 0, total: 0, lastError };
}

describe('useSyncHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = null;
    useEngineStatus.setState({ readyNonce: 0 });
  });

  it('reports nothing before any sync has run', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastError).toBeNull();
    expect(result.current.lastSuccessAt).toBeNull();
  });

  it('reads the persisted success time on mount', () => {
    const engine = fakeEngine({ [LAST_SUCCESS_KEY]: '2026-08-01T10:00:00.000Z' });
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useSyncHealth());

    expect(result.current.lastSuccessAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('re-reads once the engine becomes ready', () => {
    mockGetEngine.mockReturnValue(null);
    const { result, rerender } = renderHook(() => useSyncHealth());
    expect(result.current.lastSuccessAt).toBeNull();

    const engine = fakeEngine({ [LAST_SUCCESS_KEY]: '2026-08-02T10:00:00.000Z' });
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    act(() => useEngineStatus.getState().markEngineReady());
    rerender(undefined);

    expect(result.current.lastSuccessAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('records the success time when a sync settles clean', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle');
    rerender(undefined);

    expect(engine.setSetting).toHaveBeenCalledWith(LAST_SUCCESS_KEY, expect.any(String));
    expect(result.current.lastSuccessAt).toBe(engine.settings.get(LAST_SUCCESS_KEY));
    expect(result.current.lastError).toBeNull();
  });

  it('does not record a success when the sync settles with an error', () => {
    const engine = fakeEngine({ [LAST_SUCCESS_KEY]: '2026-08-01T10:00:00.000Z' });
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle', 'network unreachable');
    rerender(undefined);

    expect(engine.setSetting).not.toHaveBeenCalled();
    expect(result.current.lastError).toBe('network unreachable');
    expect(result.current.lastSuccessAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('keeps the earlier success time across a second failing sync', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle');
    rerender(undefined);
    const firstSuccess = result.current.lastSuccessAt;

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle', 'HTTP 503');
    rerender(undefined);

    expect(result.current.lastError).toBe('HTTP 503');
    expect(result.current.lastSuccessAt).toBe(firstSuccess);
    expect(engine.setSetting).toHaveBeenCalledTimes(1);
  });

  it('clears the error once a later sync lands', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle', 'HTTP 503');
    rerender(undefined);
    expect(result.current.lastError).toBe('HTTP 503');

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle');
    rerender(undefined);

    expect(result.current.lastError).toBeNull();
    expect(result.current.lastSuccessAt).not.toBeNull();
  });

  it('treats an expired credential as a failure, not a success', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('authExpired', '401');
    rerender(undefined);

    expect(engine.setSetting).not.toHaveBeenCalled();
    expect(result.current.lastSuccessAt).toBeNull();
    expect(result.current.lastError).toBe('401');
  });

  it('does not record a success without a preceding sync', () => {
    const engine = fakeEngine();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('idle');
    rerender(undefined);

    expect(engine.setSetting).not.toHaveBeenCalled();
  });

  it('survives a missing engine when a sync settles', () => {
    mockGetEngine.mockReturnValue(null);

    const { result, rerender } = renderHook(() => useSyncHealth());

    mockStatus = status('syncing');
    rerender(undefined);
    mockStatus = status('idle');
    rerender(undefined);

    expect(result.current.lastSuccessAt).not.toBeNull();
  });
});

/**
 * Scenario: the launch trigger declined the cutover because the elevation
 * backfill still owed fetches, and the backfill drained while the app sat in
 * the background.
 * Expected behaviour: the next return to the foreground asks again, with the
 * launch trigger's own guards, so a declined launch does not cost the whole
 * process. Demo mode never asks.
 */
import React from 'react';
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useCutoverRetry } from '@/features/routes/hooks/useCutoverRetry';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: jest.fn(() => ({ isDemoMode: false })) },
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockGetState = useAuthStore.getState as jest.Mock;

interface EngineParts {
  pending?: boolean;
  running?: boolean;
  remaining?: number | null;
  start?: jest.Mock;
}

function engineWith({ pending = true, running = false, remaining = 0, start }: EngineParts) {
  return {
    isCutoverPending: jest.fn(() => pending),
    isCutoverRunning: jest.fn(() => running),
    getElevationBackfillRemaining: jest.fn(() => remaining),
    startDetectorCutover: start ?? jest.fn(() => true),
  };
}

function useEngine(engine: ReturnType<typeof engineWith>) {
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

describe('useCutoverRetry', () => {
  let listener: ((status: string) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = null;
    mockGetState.mockReturnValue({ isDemoMode: false });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      listener = handler as (status: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The trigger's in-flight latch clears in a microtask, so let it settle.
  async function foreground() {
    await act(async () => listener?.('background'));
    await act(async () => listener?.('active'));
  }

  it('starts the cutover on foreground once the backfill has drained', async () => {
    const start = jest.fn(() => true);
    const engine = engineWith({ remaining: 12, start });
    useEngine(engine);
    renderHook(() => useCutoverRetry(), { wrapper });

    await foreground();
    expect(start).not.toHaveBeenCalled();

    engine.getElevationBackfillRemaining.mockReturnValue(0);
    await foreground();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts nothing while the backfill still owes fetches', async () => {
    const start = jest.fn(() => true);
    useEngine(engineWith({ remaining: 3, start }));
    renderHook(() => useCutoverRetry(), { wrapper });

    await foreground();
    await foreground();

    expect(start).not.toHaveBeenCalled();
  });

  it('does not start a second run while one is in flight', async () => {
    const start = jest.fn(() => true);
    const engine = engineWith({ start });
    useEngine(engine);
    renderHook(() => useCutoverRetry(), { wrapper });

    await foreground();
    engine.isCutoverRunning.mockReturnValue(true);
    await foreground();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('asks nothing at mount, only on a return from the background', async () => {
    const start = jest.fn(() => true);
    useEngine(engineWith({ start }));
    renderHook(() => useCutoverRetry(), { wrapper });

    act(() => listener?.('active'));

    expect(start).not.toHaveBeenCalled();
  });

  it('never asks in demo mode', async () => {
    mockGetState.mockReturnValue({ isDemoMode: true });
    const start = jest.fn(() => true);
    useEngine(engineWith({ start }));
    renderHook(() => useCutoverRetry(), { wrapper });

    await foreground();

    expect(start).not.toHaveBeenCalled();
  });

  it('survives an engine that throws', async () => {
    mockGetEngine.mockReturnValue({
      isCutoverPending: jest.fn(() => {
        throw new Error('engine gone');
      }),
    } as unknown as ReturnType<typeof getEngine>);
    renderHook(() => useCutoverRetry(), { wrapper });

    await expect(foreground()).resolves.toBeUndefined();
  });
});

/**
 * Scenario: the launch trigger declined the cutover because the elevation
 * backfill still owed fetches, and the backfill drained while the app sat in
 * the background.
 * Expected behaviour: the next return to the foreground asks again, with the
 * launch trigger's own guards, so a declined launch does not cost the whole
 * process. Demo mode never asks.
 *
 * A backfill that drains while the app stays open in the foreground gets no
 * such cycle, so the engine's own phase announcement asks too. Otherwise the
 * cutover waits for a background and foreground pair that may be hours away.
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

/** The channel the engine announces each backfill phase on. */
const PHASE_CHANNEL = 'backfillPhase';

let announce: (() => void) | null = null;

function engineWith({ pending = true, running = false, remaining = 0, start }: EngineParts) {
  return {
    isCutoverPending: jest.fn(() => pending),
    isCutoverRunning: jest.fn(() => running),
    getElevationBackfillRemaining: jest.fn(() => remaining),
    startDetectorCutover: start ?? jest.fn(() => true),
    subscribe: jest.fn((channel: string, handler: () => void) => {
      if (channel === PHASE_CHANNEL) announce = handler;
      return () => {
        announce = null;
      };
    }),
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
    announce = null;
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

  it('asks again when the backfill announces a phase, with no foreground cycle', async () => {
    const start = jest.fn(() => true);
    const engine = engineWith({ remaining: 12, start });
    useEngine(engine);
    renderHook(() => useCutoverRetry(), { wrapper });

    await act(async () => announce?.());
    expect(start).not.toHaveBeenCalled();

    engine.getElevationBackfillRemaining.mockReturnValue(0);
    await act(async () => announce?.());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('subscribes to the phase channel and drops it on unmount', () => {
    const engine = engineWith({});
    useEngine(engine);
    const { unmount } = renderHook(() => useCutoverRetry(), { wrapper });

    expect(engine.subscribe).toHaveBeenCalledWith(PHASE_CHANNEL, expect.any(Function));
    unmount();
    expect(announce).toBeNull();
  });

  it('never asks on an announcement in demo mode', async () => {
    mockGetState.mockReturnValue({ isDemoMode: true });
    const start = jest.fn(() => true);
    useEngine(engineWith({ start }));
    renderHook(() => useCutoverRetry(), { wrapper });

    await act(async () => announce?.());

    expect(start).not.toHaveBeenCalled();
  });

  it('survives an engine that cannot be subscribed to at all', () => {
    mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
    expect(() => renderHook(() => useCutoverRetry(), { wrapper }).unmount()).not.toThrow();
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

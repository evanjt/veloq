/**
 * Scenario: a screen's hook mounts before the root layout has opened the
 * engine, which is every cold launch. The handle exists before and after the
 * open, so only the answer to "is it open" can move.
 * Expected behaviour: false while the engine is not open, true on the render
 * the ready nonce triggers once it is, with no polling of its own.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { isEngineReady } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: jest.fn(),
}));

const mockIsEngineReady = isEngineReady as jest.MockedFunction<typeof isEngineReady>;

describe('useEngineReady', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEngineStatus.setState({ readyNonce: 0 });
  });

  it('answers false while the engine is not open', async () => {
    mockIsEngineReady.mockReturnValue(false);

    const { result } = await renderHook(() => useEngineReady());

    expect(result.current).toBe(false);
  });

  it('answers true on the render the ready nonce triggers', async () => {
    mockIsEngineReady.mockReturnValue(false);
    const { result } = await renderHook(() => useEngineReady());
    expect(result.current).toBe(false);

    mockIsEngineReady.mockReturnValue(true);
    await act(() => useEngineStatus.getState().markEngineReady());

    expect(result.current).toBe(true);
  });

  it('answers false again after the engine closes and the nonce moves', async () => {
    mockIsEngineReady.mockReturnValue(true);
    const { result } = await renderHook(() => useEngineReady());
    expect(result.current).toBe(true);

    mockIsEngineReady.mockReturnValue(false);
    await act(() => useEngineStatus.getState().markEngineReady());

    expect(result.current).toBe(false);
  });
});

/**
 * Scenario: a screen's hook mounts before the root layout has opened the
 * engine, which is every cold launch.
 * Expected behaviour: it sees null, then sees the handle on the render the
 * ready nonce triggers, with no polling of its own.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useEngineReady } from '@/shared/native/useEngineReady';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const HANDLE = { id: 'engine' } as unknown as ReturnType<typeof getEngine>;

describe('useEngineReady', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEngineStatus.setState({ readyNonce: 0 });
  });

  it('answers null while the engine is not open', () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = renderHook(() => useEngineReady());

    expect(result.current).toBeNull();
  });

  it('answers the handle on the render the ready nonce triggers', () => {
    mockGetEngine.mockReturnValue(null);
    const { result } = renderHook(() => useEngineReady());
    expect(result.current).toBeNull();

    mockGetEngine.mockReturnValue(HANDLE);
    act(() => useEngineStatus.getState().markEngineReady());

    expect(result.current).toBe(HANDLE);
  });

  it('answers the replacement after a clear reopens the engine', () => {
    mockGetEngine.mockReturnValue(HANDLE);
    const { result } = renderHook(() => useEngineReady());
    expect(result.current).toBe(HANDLE);

    const replacement = { id: 'reopened' } as unknown as ReturnType<typeof getEngine>;
    mockGetEngine.mockReturnValue(replacement);
    act(() => useEngineStatus.getState().markEngineReady());

    expect(result.current).toBe(replacement);
  });
});

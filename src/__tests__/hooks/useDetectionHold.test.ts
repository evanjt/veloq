import { act, renderHook } from '@testing-library/react-native';

import { useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const subscribers: (() => void)[] = [];

function engineWith(pending: boolean, running = false) {
  return {
    isCutoverPending: jest.fn(() => pending),
    isCutoverRunning: jest.fn(() => running),
    subscribe: jest.fn((_event: string, cb: () => void) => {
      subscribers.push(cb);
      return () => {};
    }),
  };
}

describe('useDetectionHold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    subscribers.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it('is held while the cutover is owed and lifts once it has run', () => {
    let pending = true;
    (getEngine as jest.Mock).mockImplementation(() => engineWith(pending));

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe(true);

    pending = false;
    act(() => jest.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
  });

  it('is held while the cutover is actually running', () => {
    (getEngine as jest.Mock).mockImplementation(() => engineWith(false, true));

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe(true);
  });

  it('stops re-reading once the hold lifts', () => {
    const engine = engineWith(false);
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe(false);

    const readsAtMount = engine.isCutoverPending.mock.calls.length;
    act(() => jest.advanceTimersByTime(30_000));
    expect(engine.isCutoverPending.mock.calls.length).toBe(readsAtMount);
  });

  it('reads as not held when the engine cannot answer', () => {
    (getEngine as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe(false);
  });

  it('re-reads when the sections channel fires', () => {
    let pending = true;
    (getEngine as jest.Mock).mockImplementation(() => engineWith(pending));

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe(true);

    pending = false;
    act(() => subscribers.forEach((cb) => cb()));
    expect(result.current).toBe(false);
  });
});

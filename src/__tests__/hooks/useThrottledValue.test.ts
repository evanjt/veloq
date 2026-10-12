import { renderHook, act } from '@testing-library/react-native';

import { useThrottledValue } from '@/features/maps/hooks/useThrottledValue';

const INTERVAL = 16;

// Date.now starts far from zero so the first value always counts as a quiet gap.
beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
});

const mount = (initial: string) =>
  renderHook(({ value }: { value: string }) => useThrottledValue(value, INTERVAL), {
    initialProps: { value: initial },
  });

const advance = async (ms: number) => {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe('useThrottledValue', () => {
  it('applies a value on the same render when the interval has passed since the last apply', async () => {
    const hook = await mount('start');
    await advance(INTERVAL * 3);

    await hook.rerender({ value: 'next' });

    expect(hook.result.current).toBe('next');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('holds the first applied value while more arrive inside one window', async () => {
    const hook = await mount('start');
    await advance(INTERVAL * 3);

    await hook.rerender({ value: 'A' });
    await advance(5);
    await hook.rerender({ value: 'B' });
    await advance(5);
    await hook.rerender({ value: 'C' });

    expect(hook.result.current).toBe('A');
  });

  it('settles on the last value once the window closes, with nothing landing after it', async () => {
    const hook = await mount('start');
    await advance(INTERVAL * 3);
    const seen: string[] = [];
    const record = () => seen.push(hook.result.current);

    await hook.rerender({ value: 'A' });
    record();
    await advance(5);
    await hook.rerender({ value: 'B' });
    record();
    await advance(5);
    await hook.rerender({ value: 'C' });
    record();

    await advance(INTERVAL - 10 - 1);
    expect(hook.result.current).toBe('A');
    await advance(1);
    expect(hook.result.current).toBe('C');
    record();

    await advance(INTERVAL * 10);
    record();

    expect(jest.getTimerCount()).toBe(0);
    expect(seen).toEqual(['A', 'A', 'A', 'C', 'C']);
  });

  it('fires no update after unmounting mid-window', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const hook = await mount('start');
    await advance(INTERVAL * 3);
    await hook.rerender({ value: 'A' });
    await advance(5);
    await hook.rerender({ value: 'B' });
    expect(jest.getTimerCount()).toBe(1);

    await hook.unmount();

    expect(jest.getTimerCount()).toBe(0);
    await advance(INTERVAL * 2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

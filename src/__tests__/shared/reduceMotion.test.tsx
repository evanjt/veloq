/**
 * Scenario: the athlete turns Reduce Motion (iOS) or Remove animations
 * (Android) on while the app is running.
 *
 * Expected behaviour: the setting is read once and then followed through the
 * change event, so every reader sees the new value without a restart, and every
 * React Native animation started through the shared primitives lands at once
 * rather than moving.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';

import {
  isReduceMotionOn,
  motionFor,
  motionLoop,
  motionSpring,
  motionTiming,
  reanimatedMode,
  useReduceMotion,
} from '@/shared/ui/reduceMotion';

// With no native animated module, Animated runs a native-driver animation in
// JavaScript, so a value can be read frame by frame.
jest.mock('react-native/Libraries/Animated/NativeAnimatedModule', () => ({
  ...jest.requireActual('react-native/Libraries/Animated/NativeAnimatedModule'),
  __esModule: true,
  default: null,
}));
jest.mock('react-native/Libraries/Animated/NativeAnimatedTurboModule', () => ({
  ...jest.requireActual('react-native/Libraries/Animated/NativeAnimatedTurboModule'),
  __esModule: true,
  default: null,
}));

let emitChange: ((enabled: boolean) => void) | undefined;
let resolveFirstRead: ((enabled: boolean) => void) | undefined;

const addEventListener = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
  event: string,
  handler: (enabled: boolean) => void
) => {
  if (event === 'reduceMotionChanged') emitChange = handler;
  return { remove: jest.fn() };
}) as unknown as typeof AccessibilityInfo.addEventListener);
const isReduceMotionEnabled = jest
  .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
  .mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveFirstRead = resolve;
      })
  );

function valueOf(value: Animated.Value): number {
  return (value as unknown as { __getValue(): number }).__getValue();
}

async function setting(enabled: boolean) {
  await act(() => {
    emitChange?.(enabled);
  });
}

describe('motionFor', () => {
  it('keeps the duration with reduce motion off and drops it to zero with it on', () => {
    expect(motionFor(false, 300)).toBe(300);
    expect(motionFor(true, 300)).toBe(0);
    expect(motionFor(true, 0)).toBe(0);
  });
});

describe('reanimatedMode', () => {
  it('leaves Reanimated on the system snapshot until the setting has been read', () => {
    expect(reanimatedMode(null)).toBe(ReduceMotion.System);
    expect(reanimatedMode(true)).toBe(ReduceMotion.Always);
    expect(reanimatedMode(false)).toBe(ReduceMotion.Never);
  });
});

describe('the live reduce-motion setting', () => {
  it('reads the setting once, then follows every change while mounted', async () => {
    const { result } = await renderHook(() => useReduceMotion());

    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    expect(result.current).toBe(false);

    await act(async () => {
      resolveFirstRead?.(true);
    });
    expect(result.current).toBe(true);
    expect(isReduceMotionOn()).toBe(true);

    await setting(false);
    expect(result.current).toBe(false);
    expect(isReduceMotionOn()).toBe(false);

    await setting(true);
    expect(result.current).toBe(true);
  });

  it('subscribes to the system once however many readers mount', async () => {
    await renderHook(() => useReduceMotion());
    await renderHook(() => useReduceMotion());

    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(
      addEventListener.mock.calls.filter(([event]) => String(event) === 'reduceMotionChanged')
    ).toHaveLength(1);
  });
});

describe('the React Native animation primitives', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('lands a timing at its end value at once with reduce motion on', async () => {
    await setting(true);
    const value = new Animated.Value(0);
    const done = jest.fn();

    motionTiming(value, { toValue: 1, duration: 300, useNativeDriver: true }).start(done);
    jest.advanceTimersByTime(20);

    expect(valueOf(value)).toBe(1);
    expect(done).toHaveBeenCalledWith({ finished: true });
  });

  it('lands a spring at its end value at once with reduce motion on', async () => {
    await setting(true);
    const value = new Animated.Value(12);

    motionSpring(value, { toValue: 0, tension: 300, friction: 20, useNativeDriver: true }).start();
    jest.advanceTimersByTime(20);

    expect(valueOf(value)).toBe(0);
  });

  it('runs a loop once rather than repeating it with reduce motion on', async () => {
    await setting(true);
    const value = new Animated.Value(1);
    const done = jest.fn();

    motionLoop(
      Animated.sequence([
        motionTiming(value, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        motionTiming(value, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
      { iterations: -1 }
    ).start(done);
    jest.advanceTimersByTime(100);

    expect(valueOf(value)).toBe(1);
    expect(done).toHaveBeenCalledWith({ finished: true });
  });

  it('moves over the duration with reduce motion off', async () => {
    await setting(false);
    const value = new Animated.Value(0);

    motionTiming(value, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    jest.advanceTimersByTime(100);

    expect(valueOf(value)).toBeGreaterThan(0);
    expect(valueOf(value)).toBeLessThan(1);
  });
});

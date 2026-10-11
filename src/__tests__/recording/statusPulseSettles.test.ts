/**
 * Scenario: the recording status dot pulses while a ride records.
 * Expected behaviour: it pulses a few times when recording starts and then
 * holds steady, so nothing blinks for longer than five seconds (WCAG 2.2.2),
 * and with the system reduce-motion setting on it never pulses at all.
 */
import { renderHook, act } from '@testing-library/react-native';
import type { Animated } from 'react-native';

import { useStatusPulseAnimation } from '@/features/recording/hooks/useStatusPulseAnimation';
import type { RecordingStatus } from '@/features/recording/types';

// With no native animated module, Animated runs a native-driver animation in
// JavaScript, so the dot's opacity can be read frame by frame.
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

let mockReduceMotion = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: () => mockReduceMotion,
}));

function opacity(value: Animated.Value): number {
  return (value as unknown as { __getValue(): number }).__getValue();
}

function sample(value: Animated.Value, ms: number, step = 50): number[] {
  const seen: number[] = [];
  for (let t = 0; t < ms; t += step) {
    act(() => {
      jest.advanceTimersByTime(step);
    });
    seen.push(opacity(value));
  }
  return seen;
}

describe('useStatusPulseAnimation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pulses after recording starts and holds a steady dot within five seconds', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RecordingStatus }) => useStatusPulseAnimation(status),
      { initialProps: { status: 'idle' as RecordingStatus } }
    );
    rerender({ status: 'recording' });

    const firstSecond = sample(result.current, 1000);
    expect(Math.min(...firstSecond)).toBeLessThan(0.9);

    sample(result.current, 4000);
    const afterFive = sample(result.current, 4000);
    expect(afterFive.every((v) => v === 1)).toBe(true);
  });

  it('pulses again from the start when recording resumes after a pause', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: RecordingStatus }) => useStatusPulseAnimation(status),
      { initialProps: { status: 'recording' as RecordingStatus } }
    );
    sample(result.current, 6000);
    rerender({ status: 'paused' });
    expect(opacity(result.current)).toBe(1);

    rerender({ status: 'recording' });
    expect(Math.min(...sample(result.current, 1000))).toBeLessThan(0.9);
    sample(result.current, 4000);
    expect(sample(result.current, 4000).every((v) => v === 1)).toBe(true);
  });

  it('holds a steady dot from the first frame with reduce motion on', () => {
    mockReduceMotion = true;
    const { result } = renderHook(
      ({ status }: { status: RecordingStatus }) => useStatusPulseAnimation(status),
      { initialProps: { status: 'recording' as RecordingStatus } }
    );
    expect(opacity(result.current)).toBe(1);
    expect(sample(result.current, 6000).every((v) => v === 1)).toBe(true);
  });
});

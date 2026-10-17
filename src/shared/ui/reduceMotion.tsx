/**
 * The system reduce-motion setting: Reduce Motion on iOS, Remove animations on
 * Android.
 *
 * It is read once and then followed through `reduceMotionChanged`, so a change
 * made while the app runs reaches every reader without a restart. Reanimated
 * captures the setting when its module loads, so `ReduceMotionSync` at the root
 * hands it the live value. React Native `Animated` reads neither platform's
 * setting for springs, and none on iOS, so every timing, spring and loop goes
 * through the primitives here, which land at the end value at once when the
 * setting is on. `scripts/lint-reduce-motion.mjs` refuses one made straight on
 * `Animated` anywhere else.
 */

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';

// Null until the first read answers.
let setting: boolean | null = null;
let following = false;
const listeners = new Set<() => void>();

function publish(enabled: boolean): void {
  if (enabled === setting) return;
  setting = enabled;
  for (const listener of listeners) listener();
}

function follow(): void {
  if (following) return;
  following = true;
  // The subscription lives as long as the app: the setting has one owner and
  // it is read for the whole session.
  AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
  AccessibilityInfo.isReduceMotionEnabled().then(
    (enabled) => {
      // A change event that arrived first is the newer answer.
      if (setting === null) publish(enabled);
    },
    () => undefined
  );
}

function subscribe(listener: () => void): () => void {
  follow();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readSetting = () => setting;
const readEnabled = () => setting ?? false;

/** Whether reduce motion is on now, for a callback that starts motion. */
export function isReduceMotionOn(): boolean {
  follow();
  return readEnabled();
}

/** Whether reduce motion is on, re-rendering when the athlete changes it. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, readEnabled);
}

/** The duration to animate over: none with reduce motion on. */
export function motionFor(reduce: boolean, durationMs: number): number {
  return reduce ? 0 : durationMs;
}

/**
 * Reanimated's mode for a setting. Before the first read Reanimated keeps the
 * snapshot it took at launch, which is the same setting read earlier.
 */
export function reanimatedMode(enabled: boolean | null): ReduceMotion {
  if (enabled === null) return ReduceMotion.System;
  return enabled ? ReduceMotion.Always : ReduceMotion.Never;
}

/** Hands Reanimated the live setting. Rendered once, at the root. */
export function ReduceMotionSync() {
  const enabled = useSyncExternalStore(subscribe, readSetting, readSetting);
  return <ReducedMotionConfig mode={reanimatedMode(enabled)} />;
}

/**
 * `Animated.timing` that lands at once with reduce motion on. The duration is
 * required, so no timing falls back to React Native's own 500 ms, which is on
 * no rung of the motion tokens.
 */
export function motionTiming(
  value: Animated.Value | Animated.ValueXY,
  config: Animated.TimingAnimationConfig & { duration: number }
): Animated.CompositeAnimation {
  const reduce = isReduceMotionOn();
  return Animated.timing(value, {
    ...config,
    duration: motionFor(reduce, config.duration),
    delay: reduce ? 0 : config.delay,
  });
}

/** `Animated.spring` that lands at once with reduce motion on. */
export function motionSpring(
  value: Animated.Value,
  config: Animated.SpringAnimationConfig & { toValue: number }
): Animated.CompositeAnimation {
  if (!isReduceMotionOn()) return Animated.spring(value, config);
  return Animated.timing(value, {
    toValue: config.toValue,
    duration: 0,
    useNativeDriver: config.useNativeDriver,
  });
}

/**
 * `Animated.loop` that runs its animation once with reduce motion on, so it
 * settles where one pass ends rather than repeating instantly forever.
 */
export function motionLoop(
  animation: Animated.CompositeAnimation,
  config?: Animated.LoopAnimationConfig
): Animated.CompositeAnimation {
  if (!isReduceMotionOn()) return Animated.loop(animation, config);
  return animation;
}

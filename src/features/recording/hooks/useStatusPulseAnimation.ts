import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { RecordingStatus } from '../types';

// Three pulses take 4.8 s, so the dot stops blinking inside the five seconds
// WCAG 2.2.2 allows and then holds steady beside the REC label.
const PULSE_CYCLES = 3;
const HALF_CYCLE_MS = 800;

// Status dot that pulses when recording starts or resumes, then holds at full
// opacity. With the system reduce-motion setting on it never pulses.
// loop.stop() in cleanup prevents updates on an unmounted component.
export function useStatusPulseAnimation(status: RecordingStatus) {
  const statusPulse = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    statusPulse.setValue(1);
    if (status !== 'recording' || reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(statusPulse, {
          toValue: 0.3,
          duration: HALF_CYCLE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(statusPulse, {
          toValue: 1,
          duration: HALF_CYCLE_MS,
          useNativeDriver: true,
        }),
      ]),
      { iterations: PULSE_CYCLES }
    );
    loop.start();
    return () => {
      loop.stop();
      statusPulse.setValue(1);
    };
  }, [status, reduceMotion, statusPulse]);

  return statusPulse;
}

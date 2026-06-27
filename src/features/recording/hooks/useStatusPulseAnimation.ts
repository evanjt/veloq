import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

import type { RecordingStatus } from '../types';

// Pulsing status dot animation. loop.stop() in cleanup prevents updates on an
// unmounted component (see CLAUDE.md).
export function useStatusPulseAnimation(status: RecordingStatus) {
  const statusPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(statusPulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(statusPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      statusPulse.setValue(1);
    }
  }, [status, statusPulse]);

  return statusPulse;
}

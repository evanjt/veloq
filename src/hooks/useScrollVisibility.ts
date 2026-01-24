/**
 * Hook for scroll-aware visibility of floating UI elements.
 * Hides on scroll down, shows on scroll up.
 */
import { useRef, useCallback } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSharedValue, withTiming, Easing } from 'react-native-reanimated';

interface UseScrollVisibilityOptions {
  /** Minimum scroll distance to trigger hide (default: 10) */
  hideThreshold?: number;
  /** Minimum scroll distance to trigger show (default: 10) */
  showThreshold?: number;
  /** Minimum Y position before hiding is allowed (default: 50) */
  minScrollY?: number;
  /** Animation duration in ms (default: 200) */
  duration?: number;
}

export function useScrollVisibility(options: UseScrollVisibilityOptions = {}) {
  const { hideThreshold = 10, showThreshold = 10, minScrollY = 50, duration = 200 } = options;

  const translateY = useSharedValue(0);
  const lastScrollY = useRef(0);
  const isVisible = useRef(true);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const currentY = event.nativeEvent.contentOffset.y;
      const diff = currentY - lastScrollY.current;

      // Scrolling down - hide (only if scrolled past minimum)
      if (diff > hideThreshold && currentY > minScrollY && isVisible.current) {
        translateY.value = withTiming(100, {
          duration,
          easing: Easing.out(Easing.cubic),
        });
        isVisible.current = false;
      }
      // Scrolling up - show
      else if (diff < -showThreshold && !isVisible.current) {
        translateY.value = withTiming(0, {
          duration,
          easing: Easing.out(Easing.cubic),
        });
        isVisible.current = true;
      }

      lastScrollY.current = currentY;
    },
    [hideThreshold, showThreshold, minScrollY, duration, translateY]
  );

  const show = useCallback(() => {
    if (!isVisible.current) {
      translateY.value = withTiming(0, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      isVisible.current = true;
    }
  }, [duration, translateY]);

  const hide = useCallback(() => {
    if (isVisible.current) {
      translateY.value = withTiming(100, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      isVisible.current = false;
    }
  }, [duration, translateY]);

  return {
    translateY,
    onScroll,
    show,
    hide,
  };
}

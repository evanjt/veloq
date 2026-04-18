import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useRecordingStore } from '@/providers/RecordingStore';

const DISCARD_HOLD_MS = 1000;

export interface UseDiscardWithAnimation {
  /** Animated value (0 → 1 over DISCARD_HOLD_MS) for progress styling */
  discardAnim: Animated.Value;
  /** Start the hold-to-discard timer + animation */
  handleDiscardPressIn: () => void;
  /** Cancel the hold-to-discard timer + animation (if still held) */
  handleDiscardPressOut: () => void;
}

/**
 * Hold-to-discard gesture handler with synchronised fill animation.
 *
 * When the user presses and holds for {@link DISCARD_HOLD_MS} (1000ms), the
 * recording store is reset and the user is navigated to `/`. Releasing early
 * cancels the action. Haptic feedback fires on press (medium) and successful
 * discard (notification success).
 *
 * The returned {@link discardAnim} ramps 0 → 1 linearly over the hold duration
 * and can be used to drive fill/progress UI.
 */
export function useDiscardWithAnimation(): UseDiscardWithAnimation {
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardAnim = useRef(new Animated.Value(0)).current;

  const clearDiscardTimer = useCallback(() => {
    if (discardTimerRef.current) {
      clearTimeout(discardTimerRef.current);
      discardTimerRef.current = null;
    }
    discardAnim.stopAnimation();
    discardAnim.setValue(0);
  }, [discardAnim]);

  useEffect(() => clearDiscardTimer, [clearDiscardTimer]);

  const handleDiscardPressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.timing(discardAnim, {
      toValue: 1,
      duration: DISCARD_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    discardTimerRef.current = setTimeout(() => {
      clearDiscardTimer();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      useRecordingStore.getState().reset();
      router.replace('/');
    }, DISCARD_HOLD_MS);
  }, [clearDiscardTimer, discardAnim]);

  const handleDiscardPressOut = useCallback(() => {
    clearDiscardTimer();
  }, [clearDiscardTimer]);

  return { discardAnim, handleDiscardPressIn, handleDiscardPressOut };
}
